// Package webui embeds the built admin app. The frontend build writes into
// dist/; a checkout without a build embeds only dist/.gitkeep and the server
// explains how to build the app instead of serving it.
package webui

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// FS returns the built app rooted at its index.html.
func FS() fs.FS {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		panic(err)
	}
	return sub
}
