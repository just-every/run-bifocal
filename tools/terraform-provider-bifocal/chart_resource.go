package main

import (
	"context"
	"encoding/json"
	"net/url"

	"github.com/hashicorp/terraform-plugin-sdk/v2/diag"
	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/schema"
)

func chartResource() *schema.Resource {
	resource := snapshotResource("chart")
	resource.Description = "A retained immutable native chart and answer. Replacing the query or visual definition creates a new chart. Destroy releases tracking and retains history."
	resource.ReadContext = readChart
	resource.CreateContext = func(ctx context.Context, d *schema.ResourceData, meta any) diag.Diagnostics {
		var document any
		if err := json.Unmarshal([]byte(d.Get("document").(string)), &document); err != nil {
			return diag.FromErr(err)
		}
		result, err := meta.(*client).call(ctx, "POST", "/chart-definitions/create", map[string]any{"document": document, "reviewedDigest": d.Get("review_digest")})
		if err != nil {
			return diag.FromErr(err)
		}
		id, ok := result["id"].(string)
		if !ok || id == "" {
			return diag.Errorf("Invalid chart creation response")
		}
		d.SetId(id)
		return readChart(ctx, d, meta)
	}
	return resource
}

func readChart(ctx context.Context, d *schema.ResourceData, meta any) diag.Diagnostics {
	result, err := meta.(*client).call(ctx, "GET", "/charts/"+url.PathEscape(d.Id()), nil)
	if err != nil {
		return diag.FromErr(err)
	}
	if result["id"] != d.Id() || result["definition"] == nil || result["visual"] == nil {
		return diag.Errorf("Invalid native chart response")
	}
	document, err := json.Marshal(map[string]any{"version": 1, "title": result["title"], "definition": result["definition"], "visual": result["visual"]})
	if err != nil {
		return diag.FromErr(err)
	}
	if err = d.Set("document", string(document)); err != nil {
		return diag.FromErr(err)
	}
	if err = d.Set("query_id", result["queryId"]); err != nil {
		return diag.FromErr(err)
	}
	return nil
}
