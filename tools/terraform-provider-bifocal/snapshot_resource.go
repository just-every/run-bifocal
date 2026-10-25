package main

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/hashicorp/terraform-plugin-sdk/v2/diag"
	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/schema"
)

// Dashboard snapshots are immutable retained history. Destroy only untracks them;
// source erasure and owner retention controls continue to own their custody.
func snapshotResource(kind string) *schema.Resource {
	resource := &schema.Resource{
		Description: "A retained immutable native " + kind + " snapshot. Replacing the definition creates a new snapshot. Destroy only removes Terraform tracking; it does not erase retained history.",
		Schema: map[string]*schema.Schema{
			"document": {Type: schema.TypeString, Required: true, ForceNew: true, StateFunc: func(v any) string { return canonical(v.(string)) }, DiffSuppressFunc: func(k, old, new string, d *schema.ResourceData) bool { return canonical(old) == canonical(new) }, DiffSuppressOnRefresh: true, ValidateFunc: func(v any, k string) ([]string, []error) {
				var document map[string]any
				if json.Unmarshal([]byte(v.(string)), &document) != nil {
					return nil, []error{errors.New("document must be normalized native " + kind + " JSON")}
				}
				return nil, nil
			}},
			"review_digest": {Type: schema.TypeString, Optional: true, Default: "", Description: "Exact fingerprint from native CLI " + kind + " review; required for creation."}, "query_id": {Type: schema.TypeString, Computed: true},
		},
		CustomizeDiff: func(ctx context.Context, d *schema.ResourceDiff, meta any) error {
			if !d.NewValueKnown("document") {
				return errors.New(kind + " definition must be known during planning")
			}
			oldDocument, newDocument := d.GetChange("document")
			if d.Id() != "" && canonical(oldDocument.(string)) == canonical(newDocument.(string)) {
				return nil
			}
			var document any
			if e := json.Unmarshal([]byte(d.Get("document").(string)), &document); e != nil {
				return e
			}
			review, e := meta.(*client).call(ctx, "POST", "/"+kind+"-definitions/review", map[string]any{"document": document})
			if e != nil {
				return e
			}
			normalized, e := json.Marshal(review["document"])
			if e != nil {
				return e
			}
			if canonical(d.Get("document").(string)) != string(normalized) {
				return errors.New("Use normalized JSON from CLI " + kind + "-export before Terraform planning")
			}
			if d.Get("review_digest") != review["digest"] {
				return errors.New("stale " + kind + " review fingerprint: review the exact native definition with the CLI, then set review_digest before planning")
			}
			return nil
		},
		CreateContext: func(ctx context.Context, d *schema.ResourceData, meta any) diag.Diagnostics {
			var document any
			if e := json.Unmarshal([]byte(d.Get("document").(string)), &document); e != nil {
				return diag.FromErr(e)
			}
			result, e := meta.(*client).call(ctx, "POST", "/"+kind+"-definitions/create", map[string]any{"document": document, "reviewedDigest": d.Get("review_digest")})
			if e != nil {
				return diag.FromErr(e)
			}
			d.SetId(result["id"].(string))
			return readSnapshot(ctx, d, meta, kind)
		},
		ReadContext: func(ctx context.Context, d *schema.ResourceData, meta any) diag.Diagnostics {
			return readSnapshot(ctx, d, meta, kind)
		},
		UpdateContext: func(ctx context.Context, d *schema.ResourceData, meta any) diag.Diagnostics { return nil },
		DeleteContext: func(ctx context.Context, d *schema.ResourceData, meta any) diag.Diagnostics {
			// Recheck current native authority even for releasing this state reference.
			if _, e := meta.(*client).call(ctx, "GET", "/"+kind+"s/"+d.Id(), nil); e != nil {
				return diag.FromErr(e)
			}
			d.SetId("")
			return diag.Diagnostics{{Severity: diag.Warning, Summary: "Retained " + kind + " history", Detail: "Terraform tracking was removed. The immutable " + kind + " and answer remain under the installation owner's retention and source-erasure controls."}}
		},
		Importer: &schema.ResourceImporter{StateContext: func(ctx context.Context, d *schema.ResourceData, meta any) ([]*schema.ResourceData, error) {
			if len(d.Id()) != 36 || strings.ContainsAny(d.Id(), "/?#:") {
				return nil, errors.New("Import with the native " + kind + " UUID")
			}
			return []*schema.ResourceData{d}, nil
		}},
	}
	if kind != "chart" {
		resource.Schema["query_ids"] = &schema.Schema{Type: schema.TypeList, Computed: true, Elem: &schema.Schema{Type: schema.TypeString}, Description: "Retained answer IDs in document card order; a single-answer artifact has one ID."}
	}
	return resource
}

func snapshotDocument(result map[string]any) (map[string]any, string, []string, error) {
	document := map[string]any{"version": 1, "title": result["title"]}
	if result["definition"] != nil {
		queryID, ok := result["queryId"].(string)
		if !ok || queryID == "" {
			return nil, "", nil, errors.New("Invalid native answer ID")
		}
		document["definition"] = result["definition"]
		return document, queryID, []string{queryID}, nil
	}
	cards, ok := result["cards"].([]any)
	if !ok || len(cards) < 2 || len(cards) > 4 {
		return nil, "", nil, errors.New("Unsupported native board definition")
	}
	definitions, queryIDs := make([]any, 0, len(cards)), make([]string, 0, len(cards))
	for _, raw := range cards {
		card, ok := raw.(map[string]any)
		if !ok || card["definition"] == nil {
			return nil, "", nil, errors.New("Invalid native board card definition")
		}
		queryID, ok := card["queryId"].(string)
		if !ok || queryID == "" {
			return nil, "", nil, errors.New("Invalid native board answer ID")
		}
		definitions = append(definitions, card["definition"])
		queryIDs = append(queryIDs, queryID)
	}
	document["cards"] = definitions
	return document, "", queryIDs, nil
}

func readSnapshot(ctx context.Context, d *schema.ResourceData, meta any, kind string) diag.Diagnostics {
	result, err := meta.(*client).call(ctx, "GET", "/"+kind+"s/"+d.Id(), nil)
	if err != nil {
		return diag.FromErr(err)
	}
	document, queryID, queryIDs, err := snapshotDocument(result)
	if err != nil {
		return diag.FromErr(err)
	}
	encoded, err := json.Marshal(document)
	if err != nil {
		return diag.FromErr(err)
	}
	for key, value := range map[string]any{"document": string(encoded), "query_id": queryID, "query_ids": queryIDs} {
		if err = d.Set(key, value); err != nil {
			return diag.FromErr(err)
		}
	}
	return nil
}
