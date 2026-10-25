package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"regexp"

	"github.com/hashicorp/terraform-plugin-sdk/v2/diag"
	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/schema"
)

var definitionIDPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,63}$`)
var definitionReviewPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

type versionedDefinition struct {
	kind, label, description, applyField string
	applyValue                           any
	parse                                func(string) (map[string]any, error)
}

func nativeVersionedDocument(raw, kind string) (map[string]any, error) {
	var document map[string]any
	if json.Unmarshal([]byte(raw), &document) != nil || document == nil {
		return nil, errors.New("document must be native " + kind + " JSON")
	}
	id, ok := document["id"].(string)
	if !ok || !definitionIDPattern.MatchString(id) || document["version"] != float64(1) {
		return nil, errors.New("document must have version 1 and a stable native " + kind + " ID")
	}
	return document, nil
}

func (v versionedDefinition) resource() *schema.Resource {
	return &schema.Resource{
		Description: v.description,
		Schema: map[string]*schema.Schema{
			"document": {
				Type: schema.TypeString, Required: true,
				StateFunc: func(v any) string { return canonical(v.(string)) },
				DiffSuppressFunc: func(k, old, next string, d *schema.ResourceData) bool {
					return canonical(old) == canonical(next)
				},
				DiffSuppressOnRefresh: true,
				ValidateFunc: func(raw any, k string) ([]string, []error) {
					if _, err := v.parse(raw.(string)); err != nil {
						return nil, []error{err}
					}
					return nil, nil
				},
			},
			"revision": {Type: schema.TypeInt, Computed: true},
			"review_digest": {
				Type: schema.TypeString, Optional: true, Default: "",
				Description: "Exact fingerprint from CLI " + v.kind + "-plan; required for a definition mutation. Import needs no fingerprint.",
			},
		},
		CustomizeDiff: v.reviewDiff,
		CreateContext: v.save, UpdateContext: v.save, ReadContext: v.read,
		DeleteContext: func(ctx context.Context, d *schema.ResourceData, meta any) diag.Diagnostics {
			// Releasing state also requires current native owner authority.
			if _, err := v.current(ctx, meta.(*client), d.Id()); err != nil {
				return diag.FromErr(err)
			}
			d.SetId("")
			return diag.Diagnostics{{Severity: diag.Warning, Summary: "Retained " + v.kind + " history", Detail: "Terraform tracking was removed. All immutable definition revisions and approval history remain under the installation owner's retention and source-erasure controls."}}
		},
		Importer: &schema.ResourceImporter{StateContext: func(ctx context.Context, d *schema.ResourceData, meta any) ([]*schema.ResourceData, error) {
			if !definitionIDPattern.MatchString(d.Id()) {
				return nil, errors.New("Import with the stable native " + v.kind + " ID")
			}
			return []*schema.ResourceData{d}, nil
		}},
	}
}

func (v versionedDefinition) reviewDiff(ctx context.Context, d *schema.ResourceDiff, meta any) error {
	if !d.NewValueKnown("document") {
		return errors.New(v.label + " document must be known during planning")
	}
	old, next := d.GetChange("document")
	if d.Id() != "" && canonical(old.(string)) == canonical(next.(string)) {
		return nil
	}
	document, err := v.parse(d.Get("document").(string))
	if err != nil {
		return err
	}
	if d.Id() != "" && document["id"] != d.Id() {
		return errors.New(v.label + " ID is immutable; use a new resource")
	}
	if !d.NewValueKnown("review_digest") || !definitionReviewPattern.MatchString(d.Get("review_digest").(string)) {
		return errors.New("Review the exact definition with CLI " + v.kind + "-plan and set review_digest before planning")
	}
	var previous any
	if d.Id() != "" {
		previous = d.Get("revision")
	}
	review, err := meta.(*client).call(ctx, "POST", "/"+v.kind+"-definitions/review", map[string]any{"document": document, "previousRevision": previous})
	if err != nil {
		return err
	}
	normalized, err := json.Marshal(review["document"])
	if err != nil {
		return err
	}
	if canonical(d.Get("document").(string)) != canonical(string(normalized)) {
		return errors.New("Use normalized native " + v.kind + " JSON from CLI export or the reviewed plan")
	}
	if d.Get("review_digest") != review["digest"] {
		return errors.New("stale " + v.kind + " review fingerprint; review the current exact definition with CLI " + v.kind + "-plan")
	}
	if v.kind == "policy" && review["active"] != false {
		return errors.New("Policy review must remain inactive")
	}
	return d.SetNewComputed("revision")
}

func (v versionedDefinition) save(ctx context.Context, d *schema.ResourceData, meta any) diag.Diagnostics {
	if d.Id() != "" && !d.HasChange("document") {
		return nil
	}
	document, err := v.parse(d.Get("document").(string))
	if err != nil {
		return diag.FromErr(err)
	}
	if d.Id() != "" && document["id"] != d.Id() {
		return diag.Errorf("%s ID is immutable; use a new resource", v.label)
	}
	if !definitionReviewPattern.MatchString(d.Get("review_digest").(string)) {
		return diag.Errorf("An exact %s review fingerprint is required for mutation", v.kind)
	}
	var previous any
	if d.Id() != "" {
		// The saved plan marks revision computed; use the prior state value.
		old, _ := d.GetChange("revision")
		previous = old
	}
	result, err := meta.(*client).call(ctx, "POST", "/"+v.kind+"-definitions/apply", map[string]any{"document": document, "previousRevision": previous, "reviewedDigest": d.Get("review_digest")})
	if err != nil {
		return diag.FromErr(err)
	}
	id, ok := result["id"].(string)
	if !ok || id != document["id"] || result[v.applyField] != v.applyValue {
		return diag.Errorf("Invalid %s apply response", v.kind)
	}
	d.SetId(id)
	return v.read(ctx, d, meta)
}

func (v versionedDefinition) current(ctx context.Context, c *client, id string) (map[string]any, error) {
	if !definitionIDPattern.MatchString(id) {
		return nil, errors.New("Invalid native " + v.kind + " ID")
	}
	result, err := c.call(ctx, "GET", "/"+v.kind+"-definitions/"+url.PathEscape(id), nil)
	if err != nil {
		return nil, err
	}
	if result["document"] == nil {
		return nil, errors.New(v.label + " definition not found under the current owner")
	}
	if v.kind == "policy" && result["active"] != false {
		return nil, errors.New("Policy definition must remain inactive")
	}
	return result, nil
}

func (v versionedDefinition) read(ctx context.Context, d *schema.ResourceData, meta any) diag.Diagnostics {
	result, err := v.current(ctx, meta.(*client), d.Id())
	if err != nil {
		return diag.FromErr(err)
	}
	document, err := json.Marshal(result["document"])
	if err != nil {
		return diag.FromErr(err)
	}
	parsed, err := v.parse(string(document))
	if err != nil {
		return diag.FromErr(err)
	}
	revision, ok := result["revision"].(float64)
	if parsed["id"] != d.Id() || !ok || revision < 1 || revision != float64(int(revision)) {
		return diag.Errorf("Invalid current %s response", v.kind)
	}
	if err = d.Set("document", string(document)); err != nil {
		return diag.FromErr(err)
	}
	if err = d.Set("revision", int(revision)); err != nil {
		return diag.FromErr(err)
	}
	return nil
}
