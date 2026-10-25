package main

import (
	"errors"

	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/schema"
)

func policyDocument(raw string) (map[string]any, error) {
	document, err := nativeVersionedDocument(raw, "policy")
	if err != nil {
		return nil, err
	}
	allowed := map[string]bool{"version": true, "id": true, "name": true, "modelId": true, "viewId": true, "filters": true, "dimensions": true, "underlying": true, "summaryExport": true, "underlyingExport": true, "maxAgeSeconds": true}
	for key := range document {
		if !allowed[key] {
			return nil, errors.New("Policy document contains an unsupported field; source grants and member IDs are not portable")
		}
	}
	return document, nil
}

func policyResource() *schema.Resource {
	return (versionedDefinition{
		kind: "policy", label: "Role policy", parse: policyDocument,
		description: "An inactive owner-managed role policy definition with immutable revisions. No member grant is activated. Destroy releases tracking and retains history.",
		applyField:  "active", applyValue: false,
	}).resource()
}
