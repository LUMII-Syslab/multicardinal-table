# RDF Toolbag

## Dev Notes

- "@radix-ui/react-use-controllable-state" is pinned to specific version because it's unstable. Since controllable state is useful to have and reinventing the existing wheel is not worth it, this library has been marked as a direct dependency.
- Added `main": "./dist/rdf-toolbag.js",` in `package.json`, so that this library can be imported locally and the entry point can be found properly.
- This project's key goal is to be integrated with Viziquer. In order to achieve this, the components are mounted into a shadow DOM root. The important consequence is that popover components (e.g. Combobox, Dialog) need to use `PortalContext` context so that users can specify a separate element (usually shadow DOM root that's a direct child of `body`). If this is not respected, the portal will mount outside shadow DOM (usually `document.body`) and the styling will most likely be overriden. 
- If you want to run some integration tests without docker, only keep *Oxigraph* as the query store provider. Oxigraph runs in memory via WASM and should cover most testing needs. Though, all query engines should be checked eventually.
