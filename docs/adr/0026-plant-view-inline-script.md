# Plant view stays one HTML page, with inline scrub script

Superseded by [ADR 0027](0027-plant-view-react-app.md).

Plant view remains server-rendered HTML/CSS/SVG in the one Wattloft process (ADR 0015). Scrub needs script; a JS bundler, chart library, or second Plant view codebase does not. The KPI page may include a small inline script; login and empty History stay zero-JS.
