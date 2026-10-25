package main

import (
	"errors"

	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/schema"
)

func metricDocument(raw string) (map[string]any, error) {
	document, err := nativeVersionedDocument(raw, "metric")
	if err != nil {
		return nil, err
	}
	if definition, ok := document["definition"].(map[string]any); !ok || definition == nil {
		return nil, errors.New("document must contain a native metric definition")
	}
	return document, nil
}

func metricResource() *schema.Resource {
	return (versionedDefinition{
		kind: "metric", label: "Metric", parse: metricDocument,
		description: "An owner-managed native metric draft with immutable revisions. Certification remains a separate exact human action. Destroy releases tracking and retains history.",
		applyField:  "state", applyValue: "draft",
	}).resource()
}
