package main

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"

	"github.com/hashicorp/terraform-plugin-sdk/v2/diag"
	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/schema"
)

var dashboardUUID = regexp.MustCompile(`^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$`)

func dashboardDefinitionDocument(raw string) (map[string]any, error) {
	var document map[string]any
	if json.Unmarshal([]byte(raw), &document) != nil || document == nil || document["version"] != float64(2) {
		return nil, errors.New("Use native version 2 dashboard authoring JSON")
	}
	for key := range document {
		if key != "version" && key != "title" && key != "cards" && key != "layout" {
			return nil, errors.New("Dashboard documents contain only version, title, cards and layout")
		}
	}
	return document, nil
}

func dashboardDefinitionResource() *schema.Resource {
	return &schema.Resource{
		Description: "An owner-managed versioned dashboard draft with independent desktop and phone layouts. Publication requires an explicit reviewed native CLI action or environment promotion. Destroy releases tracking and retains history.",
		Schema: map[string]*schema.Schema{
			"document": {Type: schema.TypeString, Required: true, StateFunc: func(v any) string { return canonical(v.(string)) }, DiffSuppressFunc: func(k, old, next string, d *schema.ResourceData) bool { return canonical(old) == canonical(next) }, DiffSuppressOnRefresh: true, ValidateFunc: func(v any, k string) ([]string, []error) {
				_, err := dashboardDefinitionDocument(v.(string))
				if err != nil {
					return nil, []error{err}
				}
				return nil, nil
			}},
			"review_digest":      {Type: schema.TypeString, Optional: true, Default: "", Description: "Exact fingerprint from CLI dashboard-definition-plan; required for draft mutations."},
			"revision":           {Type: schema.TypeInt, Computed: true},
			"published_revision": {Type: schema.TypeInt, Computed: true, Description: "Current published revision, or zero when no revision has been published."},
			"generation":         {Type: schema.TypeInt, Computed: true},
		},
		CustomizeDiff: func(ctx context.Context, d *schema.ResourceDiff, meta any) error {
			if !d.NewValueKnown("document") {
				return errors.New("Dashboard document must be known during planning")
			}
			old, next := d.GetChange("document")
			if d.Id() != "" && canonical(old.(string)) == canonical(next.(string)) {
				return nil
			}
			document, err := dashboardDefinitionDocument(d.Get("document").(string))
			if err != nil {
				return err
			}
			body := map[string]any{"document": document}
			if d.Id() != "" {
				body["id"] = d.Id()
				body["previousRevision"] = d.Get("revision")
			}
			review, err := meta.(*client).call(ctx, "POST", "/dashboard-authoring/review", body)
			if err != nil {
				return err
			}
			normalized, err := json.Marshal(review["document"])
			if err != nil {
				return err
			}
			if canonical(d.Get("document").(string)) != canonical(string(normalized)) {
				return errors.New("Use normalized native JSON from CLI dashboard-definition-export or the reviewed plan")
			}
			if !d.NewValueKnown("review_digest") || !definitionReviewPattern.MatchString(d.Get("review_digest").(string)) || d.Get("review_digest") != review["digest"] {
				return errors.New("stale dashboard review fingerprint; review the exact current draft with CLI dashboard-definition-plan")
			}
			return d.SetNewComputed("revision")
		},
		CreateContext: saveDashboardDefinition, UpdateContext: saveDashboardDefinition, ReadContext: readDashboardDefinition,
		DeleteContext: func(ctx context.Context, d *schema.ResourceData, meta any) diag.Diagnostics {
			if _, err := meta.(*client).call(ctx, "GET", "/dashboard-authoring/"+d.Id(), nil); err != nil {
				return diag.FromErr(err)
			}
			d.SetId("")
			return diag.Diagnostics{{Severity: diag.Warning, Summary: "Retained dashboard history", Detail: "Terraform tracking was removed. Dashboard drafts, publication history and retained answers remain under owner custody and source-erasure controls."}}
		},
		Importer: &schema.ResourceImporter{StateContext: func(ctx context.Context, d *schema.ResourceData, meta any) ([]*schema.ResourceData, error) {
			if !dashboardUUID.MatchString(d.Id()) {
				return nil, errors.New("Import with the native dashboard definition UUID")
			}
			return []*schema.ResourceData{d}, nil
		}},
	}
}

func saveDashboardDefinition(ctx context.Context, d *schema.ResourceData, meta any) diag.Diagnostics {
	if d.Id() != "" && !d.HasChange("document") {
		return nil
	}
	document, err := dashboardDefinitionDocument(d.Get("document").(string))
	if err != nil {
		return diag.FromErr(err)
	}
	if !definitionReviewPattern.MatchString(d.Get("review_digest").(string)) {
		return diag.Errorf("An exact dashboard review fingerprint is required")
	}
	body := map[string]any{"document": document, "reviewedDigest": d.Get("review_digest")}
	if d.Id() != "" {
		old, _ := d.GetChange("revision")
		body["id"] = d.Id()
		body["previousRevision"] = old
	}
	result, err := meta.(*client).call(ctx, "POST", "/dashboard-authoring/apply", body)
	if err != nil {
		return diag.FromErr(err)
	}
	id, ok := result["id"].(string)
	if !ok || !dashboardUUID.MatchString(id) || d.Id() != "" && id != d.Id() {
		return diag.Errorf("Invalid dashboard apply response")
	}
	d.SetId(id)
	return readDashboardDefinition(ctx, d, meta)
}

func readDashboardDefinition(ctx context.Context, d *schema.ResourceData, meta any) diag.Diagnostics {
	if !dashboardUUID.MatchString(d.Id()) {
		return diag.Errorf("Invalid native dashboard definition UUID")
	}
	result, err := meta.(*client).call(ctx, "GET", "/dashboard-authoring/"+d.Id(), nil)
	if err != nil {
		return diag.FromErr(err)
	}
	document, err := json.Marshal(result["definition"])
	if err != nil {
		return diag.FromErr(err)
	}
	if _, err = dashboardDefinitionDocument(string(document)); err != nil {
		return diag.FromErr(err)
	}
	values := map[string]any{"document": string(document)}
	for key, remote := range map[string]string{"revision": "revision", "published_revision": "publishedRevision", "generation": "generation"} {
		raw := result[remote]
		if raw == nil && key == "published_revision" {
			values[key] = 0
			continue
		}
		n, ok := raw.(float64)
		if !ok || n < 0 || n != float64(int(n)) || key == "revision" && n < 1 {
			return diag.Errorf("Invalid current dashboard %s", remote)
		}
		values[key] = int(n)
	}
	for key, value := range values {
		if err = d.Set(key, value); err != nil {
			return diag.FromErr(err)
		}
	}
	return nil
}
