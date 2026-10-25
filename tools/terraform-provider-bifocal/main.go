package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"syscall"
	"time"

	"github.com/hashicorp/terraform-plugin-sdk/v2/diag"
	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/schema"
	"github.com/hashicorp/terraform-plugin-sdk/v2/plugin"
)

type client struct {
	origin, cookie string
	http           *http.Client
}

func (c *client) call(ctx context.Context, method, path string, input any) (map[string]any, error) {
	var body io.Reader
	if input != nil {
		b, e := json.Marshal(input)
		if e != nil {
			return nil, e
		}
		body = bytes.NewReader(b)
	}
	req, e := http.NewRequestWithContext(ctx, method, c.origin+"/api/operator"+path, body)
	if e != nil {
		return nil, e
	}
	req.Header.Set("Cookie", c.cookie)
	req.Header.Set("Origin", c.origin)
	req.Header.Set("Content-Type", "application/json")
	response, e := c.http.Do(req)
	if e != nil {
		return nil, errors.New("Bifocal request failed; check origin and current native owner session")
	}
	defer response.Body.Close()
	var result map[string]any
	if e = json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&result); e != nil {
		return nil, errors.New("Bifocal response could not be read")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("Bifocal refused the operation (%d): %v", response.StatusCode, result["error"])
	}
	return result, nil
}
func configure(ctx context.Context, d *schema.ResourceData) (any, diag.Diagnostics) {
	origin := d.Get("origin").(string)
	u, e := url.Parse(origin)
	if e != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" && u.Path != "/" || u.Host == "" || u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1")) {
		return nil, diag.Errorf("Use an HTTPS app origin or loopback HTTP")
	}
	// Read the current operator's private file; neither its path nor cookie is a resource field.
	path := os.Getenv("BIFOCAL_SESSION_FILE")
	fd, e := syscall.Open(path, syscall.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if e != nil {
		return nil, diag.Errorf("BIFOCAL_SESSION_FILE must name your own mode-0600 native session file")
	}
	file := os.NewFile(uintptr(fd), path)
	defer file.Close()
	info, e := file.Stat()
	if e != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Getuid()) {
		return nil, diag.Errorf("BIFOCAL_SESSION_FILE must name your own mode-0600 native session file")
	}
	data, e := io.ReadAll(io.LimitReader(file, 16385))
	if e != nil || len(data) > 16384 {
		return nil, diag.Errorf("Invalid native session file")
	}
	cookie := strings.TrimSpace(string(data))
	if cookie == "" || strings.ContainsAny(cookie, "\r\n\x00") {
		return nil, diag.Errorf("Invalid native session file")
	}
	return &client{origin: strings.TrimSuffix(origin, "/"), cookie: cookie, http: &http.Client{Timeout: 45 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("redirect refused") }}}, nil
}
func canonical(s string) string {
	var value any
	if json.Unmarshal([]byte(s), &value) != nil {
		return s
	}
	b, _ := json.Marshal(value)
	return string(b)
}
func parts(id string) (string, string, error) {
	p := strings.Split(id, ":")
	if len(p) != 2 || len(p[0]) != 36 || len(p[1]) != 36 || strings.ContainsAny(id, "/?#") {
		return "", "", errors.New("Import with model UUID, colon, branch UUID")
	}
	return p[0], p[1], nil
}
func input(document string, model, branch string, version any) map[string]any {
	result := map[string]any{"document": document}
	if model != "" {
		result["modelId"] = model
		result["branchId"] = branch
		result["previousVersion"] = version
	}
	return result
}
func main() {
	plugin.Serve(&plugin.ServeOpts{ProviderFunc: func() *schema.Provider {
		return &schema.Provider{
			Schema:               map[string]*schema.Schema{"origin": {Type: schema.TypeString, Required: true, DefaultFunc: schema.EnvDefaultFunc("BIFOCAL_ORIGIN", nil), Description: "HTTPS app origin or loopback HTTP. Current native owner session comes only from BIFOCAL_SESSION_FILE."}},
			ConfigureContextFunc: configure, ResourcesMap: map[string]*schema.Resource{"bifocal_model_branch": resource(), "bifocal_dashboard_snapshot": snapshotResource("dashboard"), "bifocal_dashboard_definition": dashboardDefinitionResource(), "bifocal_report_snapshot": snapshotResource("report"), "bifocal_schedule_definition": scheduleResource(), "bifocal_metric_definition": metricResource(), "bifocal_chart_snapshot": chartResource(), "bifocal_role_policy_definition": policyResource(), "bifocal_environment_definition": environmentResource()},
		}
	}})
}
func resource() *schema.Resource {
	return &schema.Resource{
		Description: "An owner-managed native draft model branch. Publication remains an exact separate human CLI approval. Published branches refuse destruction.",
		Schema: map[string]*schema.Schema{
			"document": {Type: schema.TypeString, Required: true, StateFunc: func(v any) string { return canonical(v.(string)) }, DiffSuppressFunc: func(k, old, new string, d *schema.ResourceData) bool { return canonical(old) == canonical(new) }, DiffSuppressOnRefresh: true, ValidateFunc: func(v any, k string) ([]string, []error) {
				var value map[string]any
				if json.Unmarshal([]byte(v.(string)), &value) != nil {
					return nil, []error{errors.New("document must be native model JSON")}
				}
				return nil, nil
			}},
			"model_id": {Type: schema.TypeString, Computed: true}, "branch_id": {Type: schema.TypeString, Computed: true},
			"branch_version": {Type: schema.TypeInt, Computed: true}, "revision": {Type: schema.TypeString, Computed: true},
			"review_digest": {Type: schema.TypeString, Optional: true, Default: "", Description: "Exact fingerprint from native CLI review; required for a mutation. Carries no authority or rows."},
		},
		CustomizeDiff: func(ctx context.Context, d *schema.ResourceDiff, meta any) error {
			if !d.NewValueKnown("document") {
				return errors.New("native document must be known during planning")
			}
			model, branch := "", ""
			var version any
			if d.Id() != "" {
				var e error
				model, branch, e = parts(d.Id())
				if e != nil {
					return e
				}
				version = d.Get("branch_version")
			}
			oldDocument, newDocument := d.GetChange("document")
			if d.Id() != "" && canonical(oldDocument.(string)) == canonical(newDocument.(string)) {
				return nil
			}
			review, e := meta.(*client).call(ctx, "POST", "/model-authoring/review", input(d.Get("document").(string), model, branch, version))
			if e != nil {
				return e
			}
			normalized, e := json.Marshal(review["definition"])
			if e != nil {
				return e
			}
			if canonical(d.Get("document").(string)) != string(normalized) {
				return errors.New("Use normalized native JSON from the CLI export command; source defaults must be explicit before Terraform planning")
			}
			if review["compatible"] != true {
				return errors.New("model compilation or quality checks failed; no plan may be applied")
			}
			if d.Get("review_digest") != review["digest"] {
				return errors.New("stale model review fingerprint: review this exact native draft with the CLI, then set review_digest before planning")
			}
			// A planned mutation creates a new immutable revision and increments this branch.
			if e = d.SetNewComputed("revision"); e != nil {
				return e
			}
			return d.SetNewComputed("branch_version")
		},
		CreateContext: save, UpdateContext: save, ReadContext: read,
		DeleteContext: func(ctx context.Context, d *schema.ResourceData, meta any) diag.Diagnostics {
			model, branch, e := parts(d.Id())
			if e != nil {
				return diag.FromErr(e)
			}
			_, e = meta.(*client).call(ctx, "DELETE", "/models/"+model+"/branches/"+branch, map[string]any{"previousVersion": d.Get("branch_version")})
			if e != nil {
				return diag.FromErr(e)
			}
			d.SetId("")
			return nil
		},
		Importer: &schema.ResourceImporter{StateContext: func(ctx context.Context, d *schema.ResourceData, meta any) ([]*schema.ResourceData, error) {
			model, branch, e := parts(d.Id())
			if e != nil {
				return nil, e
			}
			if e = d.Set("model_id", model); e != nil {
				return nil, e
			}
			if e = d.Set("branch_id", branch); e != nil {
				return nil, e
			}
			return []*schema.ResourceData{d}, nil
		}},
	}
}
func save(ctx context.Context, d *schema.ResourceData, meta any) diag.Diagnostics {
	if d.Id() != "" && !d.HasChange("document") {
		return nil
	}
	model, branch := "", ""
	var version any
	if d.Id() != "" {
		var e error
		model, branch, e = parts(d.Id())
		if e != nil {
			return diag.FromErr(e)
		}
		old, _ := d.GetChange("branch_version")
		version = old
	}
	body := input(d.Get("document").(string), model, branch, version)
	body["reviewedDigest"] = d.Get("review_digest")
	result, e := meta.(*client).call(ctx, "POST", "/model-authoring/create", body)
	if e != nil {
		return diag.FromErr(e)
	}
	d.SetId(result["modelId"].(string) + ":" + result["branchId"].(string))
	return read(ctx, d, meta)
}
func read(ctx context.Context, d *schema.ResourceData, meta any) diag.Diagnostics {
	model, branch, e := parts(d.Id())
	if e != nil {
		return diag.FromErr(e)
	}
	result, e := meta.(*client).call(ctx, "GET", "/models/"+model+"/branches/"+branch, nil)
	if e != nil {
		return diag.FromErr(e)
	}
	document, e := json.Marshal(result["definition"])
	if e != nil {
		return diag.FromErr(e)
	}
	for k, v := range map[string]any{"model_id": model, "branch_id": branch, "revision": result["revision_id"], "branch_version": int(result["version"].(float64)), "document": string(document)} {
		if e = d.Set(k, v); e != nil {
			return diag.FromErr(e)
		}
	}
	return nil
}

// Schedule definitions have no dispatch authority. Revisions remain immutable.
func scheduleResource() *schema.Resource {
	return &schema.Resource{
		Description: "A versioned native civil-time schedule definition. No subscription or dispatch is activated. Destroy releases tracking and retains history.",
		Schema: map[string]*schema.Schema{
			"document":      {Type: schema.TypeString, Required: true, StateFunc: func(v any) string { return canonical(v.(string)) }, DiffSuppressFunc: func(k, old, new string, d *schema.ResourceData) bool { return canonical(old) == canonical(new) }, DiffSuppressOnRefresh: true},
			"version":       {Type: schema.TypeInt, Computed: true},
			"review_digest": {Type: schema.TypeString, Optional: true, Default: ""},
		},
		CustomizeDiff: func(ctx context.Context, d *schema.ResourceDiff, meta any) error {
			if !d.NewValueKnown("document") {
				return errors.New("Schedule document must be known during planning")
			}
			old, next := d.GetChange("document")
			if d.Id() != "" && canonical(old.(string)) == canonical(next.(string)) {
				return nil
			}
			var document map[string]any
			if json.Unmarshal([]byte(d.Get("document").(string)), &document) != nil {
				return errors.New("Schedule document must be native JSON")
			}
			if d.Id() != "" && document["id"] != d.Id() {
				return errors.New("Schedule id is immutable; use a new resource")
			}
			var previous any
			if d.Id() != "" {
				previous = d.Get("version")
			}
			review, e := meta.(*client).call(ctx, "POST", "/schedule-definitions/review", map[string]any{"document": document, "previousVersion": previous})
			if e != nil {
				return e
			}
			normalized, _ := json.Marshal(review["document"])
			if canonical(d.Get("document").(string)) != string(normalized) {
				return errors.New("Use normalized native schedule JSON from CLI schedule-export")
			}
			if d.Get("review_digest") != review["digest"] {
				return errors.New("stale schedule review fingerprint: review the exact schedule with the CLI")
			}
			return d.SetNewComputed("version")
		},
		CreateContext: saveSchedule, UpdateContext: saveSchedule, ReadContext: readSchedule,
		DeleteContext: func(ctx context.Context, d *schema.ResourceData, meta any) diag.Diagnostics {
			if _, e := meta.(*client).call(ctx, "GET", "/schedules/"+url.PathEscape(d.Id()), nil); e != nil {
				return diag.FromErr(e)
			}
			d.SetId("")
			return diag.Diagnostics{{Severity: diag.Warning, Summary: "Retained schedule definition", Detail: "Terraform tracking was removed. Immutable schedule history remains. No dispatcher is connected."}}
		},
		Importer: &schema.ResourceImporter{StateContext: func(ctx context.Context, d *schema.ResourceData, meta any) ([]*schema.ResourceData, error) {
			return []*schema.ResourceData{d}, nil
		}},
	}
}
func saveSchedule(ctx context.Context, d *schema.ResourceData, meta any) diag.Diagnostics {
	if d.Id() != "" && !d.HasChange("document") {
		return nil
	}
	var document map[string]any
	if e := json.Unmarshal([]byte(d.Get("document").(string)), &document); e != nil {
		return diag.FromErr(e)
	}
	var previous any
	if d.Id() != "" {
		old, _ := d.GetChange("version")
		previous = old
	}
	result, e := meta.(*client).call(ctx, "POST", "/schedule-definitions/apply", map[string]any{"document": document, "previousVersion": previous, "reviewedDigest": d.Get("review_digest")})
	if e != nil {
		return diag.FromErr(e)
	}
	d.SetId(result["id"].(string))
	return readSchedule(ctx, d, meta)
}
func readSchedule(ctx context.Context, d *schema.ResourceData, meta any) diag.Diagnostics {
	c := meta.(*client)
	result, e := c.call(ctx, "GET", "/schedules/"+url.PathEscape(d.Id()), nil)
	if e != nil {
		return diag.FromErr(e)
	}
	versions, ok := result["versions"].([]any)
	if !ok || len(versions) == 0 {
		return diag.Errorf("Schedule definition not found")
	}
	version := versions[0].(map[string]any)["version"]
	saved, e := c.call(ctx, "GET", fmt.Sprintf("/schedules/%s/%.0f", url.PathEscape(d.Id()), version), nil)
	if e != nil {
		return diag.FromErr(e)
	}
	definition, ok := saved["definition"].(map[string]any)
	if !ok {
		return diag.Errorf("Invalid native schedule definition")
	}
	portable := definition["document"]
	if portable == nil {
		delete(definition, "resolution")
		delete(definition, "dispatcher")
		portable = map[string]any{"version": 1, "id": d.Id(), "definition": definition}
	}
	document, e := json.Marshal(portable)
	if e != nil {
		return diag.FromErr(e)
	}
	if e = d.Set("document", string(document)); e != nil {
		return diag.FromErr(e)
	}
	if e = d.Set("version", int(version.(float64))); e != nil {
		return diag.FromErr(e)
	}
	return nil
}
