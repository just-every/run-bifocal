package main

import (
	"errors"

	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/schema"
)

func environmentDocument(raw string) (map[string]any, error) {
	document, err := nativeVersionedDocument(raw, "environment")
	if err != nil {
		return nil, err
	}
	for key := range document {
		if key != "version" && key != "id" && key != "name" && key != "resources" {
			return nil, errors.New("Environment documents contain only a name and local resource references")
		}
	}
	resources, ok := document["resources"].([]any)
	if !ok || len(resources) == 0 {
		return nil, errors.New("Environment document requires resource references")
	}
	kinds := map[string]bool{"model": true, "metric": true, "chart": true, "dashboard": true, "report": true, "policy": true, "schedule": true}
	fields := map[string]bool{"key": true, "kind": true, "id": true, "branchId": true, "revisionId": true, "revision": true, "version": true}
	for _, raw := range resources {
		ref, ok := raw.(map[string]any)
		if !ok {
			return nil, errors.New("Invalid environment resource reference")
		}
		kind, ok := ref["kind"].(string)
		if !ok || !kinds[kind] {
			return nil, errors.New("Unsupported environment resource kind")
		}
		for key := range ref {
			if !fields[key] {
				return nil, errors.New("Environment references cannot contain credentials, grants or inline definitions")
			}
		}
		for _, key := range []string{"key", "id"} {
			value, ok := ref[key].(string)
			if !ok || value == "" {
				return nil, errors.New("Environment resource requires a key and native ID")
			}
		}
		if kind == "model" {
			for _, key := range []string{"branchId", "revisionId"} {
				value, ok := ref[key].(string)
				if !ok || value == "" {
					return nil, errors.New("Model references require an exact branch and revision ID")
				}
			}
		}
		numeric := ""
		if kind == "metric" || kind == "policy" {
			numeric = "revision"
		}
		if kind == "schedule" {
			numeric = "version"
		}
		if numeric != "" {
			value, ok := ref[numeric].(float64)
			if !ok || value < 1 || value != float64(int(value)) {
				return nil, errors.New("Versioned resource references require an exact positive revision or version")
			}
		}
	}
	return document, nil
}

func environmentResource() *schema.Resource {
	return (versionedDefinition{
		kind: "environment", label: "Environment", parse: environmentDocument,
		description: "An owner-managed environment draft containing local exact resource references. Terraform creates immutable drafts; publication and rollback require separate exact human CLI actions. Destroy releases tracking and retains history.",
		applyField:  "state", applyValue: "draft",
	}).resource()
}
