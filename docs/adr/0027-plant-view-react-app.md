# Plant view is a React app with a Node BFF

Supersedes [ADR 0026](0026-plant-view-inline-script.md).

Plant view is the `plant-view` package: Vite + React for the Operator surfaces, Hono for login/session and `/api/plant`. It is not server-rendered HTML/CSS/SVG in the Python process. Login and empty History may include the React bundle. v1 surfaces and copy stay.
