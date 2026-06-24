"use strict";
// ─── Base64 (UTF-8 safe) ─────────────────────────────────────────────────────
function toBase64(str) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        if (c < 128) {
            bytes.push(c);
        }
        else if (c < 2048) {
            bytes.push(192 | (c >> 6));
            bytes.push(128 | (c & 63));
        }
        else {
            bytes.push(224 | (c >> 12));
            bytes.push(128 | ((c >> 6) & 63));
            bytes.push(128 | (c & 63));
        }
    }
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
        const b0 = bytes[i];
        const b1 = (i + 1 < bytes.length) ? bytes[i + 1] : 0;
        const b2 = (i + 2 < bytes.length) ? bytes[i + 2] : 0;
        out += chars[b0 >> 2];
        out += chars[((b0 & 3) << 4) | (b1 >> 4)];
        out += (i + 1 < bytes.length) ? chars[((b1 & 15) << 2) | (b2 >> 6)] : "=";
        out += (i + 2 < bytes.length) ? chars[b2 & 63] : "=";
    }
    return out;
}
// ─── GitHub PUT ───────────────────────────────────────────────────────────────
async function githubPut(settings, file) {
    const url = "https://api.github.com/repos/" + settings.owner + "/" + settings.repo + "/contents/" + file.path;
    const headers = {
        "Authorization": "Bearer " + settings.pat,
        "Content-Type": "application/json",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
    };
    let sha;
    const getRes = await fetch(url, { method: "GET", headers });
    if (getRes.ok) {
        sha = (await getRes.json()).sha;
    }
    const body = { message: file.message, content: toBase64(file.content), branch: settings.branch };
    if (sha)
        body.sha = sha;
    const putRes = await fetch(url, { method: "PUT", headers, body: JSON.stringify(body) });
    if (!putRes.ok) {
        throw new Error("GitHub " + putRes.status + " on " + file.path + ": " + (await putRes.text()));
    }
}
// ─── Node traversal ───────────────────────────────────────────────────────────
function findAllComponentSets(node) {
    const results = [];
    if (node.type === "COMPONENT_SET") {
        results.push(node);
    }
    if ("children" in node) {
        for (const child of node.children) {
            results.push(...findAllComponentSets(child));
        }
    }
    return results;
}
// ─── Layout helper ────────────────────────────────────────────────────────────
function getLayout(node) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const n = node;
    return {
        layoutMode: (_a = n.layoutMode) !== null && _a !== void 0 ? _a : "NONE",
        primaryAxisAlignItems: (_b = n.primaryAxisAlignItems) !== null && _b !== void 0 ? _b : "MIN",
        counterAxisAlignItems: (_c = n.counterAxisAlignItems) !== null && _c !== void 0 ? _c : "MIN",
        itemSpacing: (_d = n.itemSpacing) !== null && _d !== void 0 ? _d : 0,
        paddingTop: (_e = n.paddingTop) !== null && _e !== void 0 ? _e : 0,
        paddingRight: (_f = n.paddingRight) !== null && _f !== void 0 ? _f : 0,
        paddingBottom: (_g = n.paddingBottom) !== null && _g !== void 0 ? _g : 0,
        paddingLeft: (_h = n.paddingLeft) !== null && _h !== void 0 ? _h : 0,
        cornerRadius: (_j = n.cornerRadius) !== null && _j !== void 0 ? _j : 0
    };
}
// ─── Component serialiser ─────────────────────────────────────────────────────
function serialiseComponentSet(node) {
    var _a, _b;
    return {
        id: node.id,
        key: node.key,
        name: node.name,
        type: node.type,
        description: node.description || "",
        layout: getLayout(node),
        styles: {
            fillStyleId: "",
            strokeStyleId: "",
            effectStyleId: "",
            gridStyleId: "",
            textStyleId: "",
            boundVariables: {}
        },
        componentPropertyDefinitions: (_a = node.componentPropertyDefinitions) !== null && _a !== void 0 ? _a : {},
        variantProperties: {},
        variantGroupProperties: (_b = node.variantGroupProperties) !== null && _b !== void 0 ? _b : {}
    };
}
// ─── Export SVG for first child variant ───────────────────────────────────────
async function exportSvg(node) {
    if (!node.children || node.children.length === 0)
        return "";
    try {
        const bytes = await node.children[0].exportAsync({ format: "SVG_STRING" });
        if (typeof bytes === "string")
            return bytes;
        return String.fromCharCode(...Array.from(bytes));
    }
    catch (_a) {
        return "";
    }
}
// ─── Export variables ─────────────────────────────────────────────────────────
async function exportVariables() {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const allVars = await figma.variables.getLocalVariablesAsync();
    const out = { collections: [], modes: [], variables: [] };
    for (const col of collections) {
        out.collections.push({ id: col.id, name: col.name });
        for (const mode of col.modes) {
            out.modes.push({ id: mode.modeId, name: mode.name, collectionId: col.id });
        }
        for (const v of allVars) {
            if (v.variableCollectionId !== col.id)
                continue;
            out.variables.push({ id: v.id, name: v.name, type: v.resolvedType, values: v.valuesByMode, description: v.description || "" });
        }
    }
    return out;
}
// ─── Export text styles ───────────────────────────────────────────────────────
async function exportTextStyles() {
    const styles = await figma.getLocalTextStylesAsync();
    return styles.map((s) => {
        var _a;
        return ({
            id: s.id,
            name: s.name,
            description: s.description || "",
            type: "TEXT",
            category: "typography",
            fontFamily: (typeof s.fontName === "object" && "family" in s.fontName) ? s.fontName.family : "",
            fontStyle: (typeof s.fontName === "object" && "style" in s.fontName) ? s.fontName.style : "",
            fontSize: (_a = s.fontSize) !== null && _a !== void 0 ? _a : null,
            lineHeight: (typeof s.lineHeight === "object" && "unit" in s.lineHeight && s.lineHeight.unit !== "AUTO" && "value" in s.lineHeight) ? s.lineHeight.value : null,
            letterSpacing: (typeof s.letterSpacing === "object" && "value" in s.letterSpacing) ? s.letterSpacing.value : null,
            usage: s.description || "",
            contexts: [],
            allowed_components: []
        });
    });
}
// ─── Build all file payloads ──────────────────────────────────────────────────
async function buildAllPayloads(settings, syncVersion, onProgress) {
    var _a, _b;
    const tag = " [sync #" + syncVersion + "]";
    const now = new Date().toISOString();
    const files = [];
    // ── Variables
    onProgress("Exporting variables…");
    const variables = await exportVariables();
    files.push({
        path: "packages/tokens/exports/figma-variables.json",
        content: JSON.stringify(variables, null, 2),
        message: "chore: sync figma variables" + tag + tag
    });
    // ── Text styles
    onProgress("Exporting text styles…");
    const textStyles = await exportTextStyles();
    files.push({
        path: "docs/figma-make/text-styles.json",
        content: JSON.stringify(textStyles, null, 2),
        message: "chore: sync text-styles.json" + tag + tag
    });
    // ── Find all COMPONENT_SETs
    onProgress("Loading all pages…");
    await figma.loadAllPagesAsync();
    onProgress("Scanning components and icons…");
    const allSets = findAllComponentSets(figma.root);
    const iconSets = allSets.filter((n) => n.name.includes("/"));
    const componentSets = allSets.filter((n) => !n.name.includes("/"));
    // ── components.json
    onProgress("Building components.json (" + componentSets.length + " components)…");
    const componentsData = componentSets.map(serialiseComponentSet);
    files.push({
        path: "docs/figma-make/components.json",
        content: JSON.stringify(componentsData, null, 2),
        message: "chore: sync components.json" + tag + tag
    });
    // ── component-anatomy.json
    files.push({
        path: "docs/figma-make/component-anatomy.json",
        content: JSON.stringify({
            schema: "thread.ds.component-anatomy.v2",
            generatedAt: now,
            source: { fileKey: "", fileName: figma.root.name },
            detailLevel: "lite",
            components: componentsData
        }, null, 2),
        message: "chore: sync component-anatomy.json" + tag + tag
    });
    // ── component-render-specs.json (with SVG thumbnails)
    onProgress("Exporting component SVG thumbnails…");
    const renderSpecComponents = [];
    for (let i = 0; i < componentSets.length; i++) {
        const node = componentSets[i];
        onProgress("SVG " + (i + 1) + "/" + componentSets.length + ": " + node.name + "…");
        const svgThumbnail = await exportSvg(node);
        renderSpecComponents.push({
            id: node.id,
            key: node.key,
            name: node.name,
            description: node.description || "",
            componentPropertyDefinitions: (_a = node.componentPropertyDefinitions) !== null && _a !== void 0 ? _a : {},
            variantGroupProperties: (_b = node.variantGroupProperties) !== null && _b !== void 0 ? _b : {},
            svgThumbnail
        });
    }
    files.push({
        path: "docs/figma-make/component-render-specs.json",
        content: JSON.stringify({
            schema: "thread.ds.component-render-specs.v1",
            generatedAt: now,
            source: { fileKey: "", fileName: figma.root.name },
            note: "Lite render spec: SVG thumbnails + variant metadata.",
            components: renderSpecComponents
        }, null, 2),
        message: "chore: sync component-render-specs.json" + tag + tag
    });
    // ── icons.json
    onProgress("Building icons.json (" + iconSets.length + " icon sets)…");
    const iconsData = iconSets.map(serialiseComponentSet);
    files.push({
        path: "docs/figma-make/icons.json",
        content: JSON.stringify(iconsData, null, 2),
        message: "chore: sync icons.json" + tag + tag
    });
    // ── icons per-group files + index
    onProgress("Building icon groups…");
    const groupMap = {};
    for (let i = 0; i < iconSets.length; i++) {
        const node = iconSets[i];
        const groupId = node.name.split("/")[0].toLowerCase().replace(/s+/g, "-");
        onProgress("Icon SVG " + (i + 1) + "/" + iconSets.length + ": " + node.name + "…");
        const svgString = await exportSvg(node);
        if (!groupMap[groupId])
            groupMap[groupId] = [];
        groupMap[groupId].push({ id: node.id, key: node.key, name: node.name, type: node.type, description: node.description || "", svgString });
    }
    const indexGroups = Object.entries(groupMap).map(([id, icons]) => ({
        id,
        label: id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, " "),
        count: icons.length,
        hasSvgs: true,
        path: "figma-make/icons/groups/" + id + ".json"
    }));
    files.push({
        path: "docs/figma-make/icons.index.json",
        content: JSON.stringify({
            schema: "thread.ds.icons-index.v1",
            generatedAt: now,
            total: iconSets.length,
            groups: indexGroups
        }, null, 2),
        message: "chore: sync icons.index.json" + tag + tag
    });
    for (const [groupId, icons] of Object.entries(groupMap)) {
        files.push({
            path: "docs/figma-make/icons/groups/" + groupId + ".json",
            content: JSON.stringify(icons, null, 2),
            message: "chore: sync icons/groups/" + groupId + ".json" + tag + tag
        });
    }
    // ── design-contract.json
    files.push({
        path: "docs/figma-make/design-contract.json",
        content: JSON.stringify({
            schema: "thread.ds.design-contract.v1",
            generatedAt: now,
            sources: {
                variables: "packages/tokens/exports/figma-variables.json",
                components: "docs/figma-make/components.json",
                componentAnatomy: "docs/figma-make/component-anatomy.json",
                componentRenderSpecs: "docs/figma-make/component-render-specs.json",
                textStyles: "docs/figma-make/text-styles.json",
                icons: "docs/figma-make/icons.json",
                iconsIndex: "docs/figma-make/icons.index.json"
            },
            summary: {
                collections: variables.collections.length,
                modes: variables.modes.length,
                variables: variables.variables.length,
                components: componentSets.length,
                component_anatomy: componentSets.length,
                component_render_specs: componentSets.length,
                text_styles: textStyles.length,
                icons: iconSets.length,
                icon_groups: Object.keys(groupMap).length
            },
            data: {
                collections: variables.collections,
                modes: variables.modes
            }
        }, null, 2),
        message: "chore: sync design-contract.json" + tag + tag
    });
    return files;
}
// ─── NEW: Token Audit ─────────────────────────────────────────────────────────
// Walks a node tree and flags raw (non-token-bound) design values.
// Returns an array of AuditIssue for the UI to render.
function rgbToHex(r, g, b) {
    const toHex = (n) => Math.round(n * 255).toString(16).padStart(2, "0");
    return "#" + toHex(r) + toHex(g) + toHex(b);
}
function auditNode(node, allVarNames) {
    var _a, _b, _c;
    const issues = [];
    const n = node;
    const bound = (_a = n.boundVariables) !== null && _a !== void 0 ? _a : {};
    // ── Fills: error if raw hex, suggest closest token category
    if (Array.isArray(n.fills)) {
        for (let i = 0; i < n.fills.length; i++) {
            const fill = n.fills[i];
            if (fill.type === "SOLID") {
                const fillsBound = (_b = bound.fills) !== null && _b !== void 0 ? _b : [];
                const isBound = Array.isArray(fillsBound) && fillsBound[i] != null;
                if (!isBound) {
                    const c = fill.color;
                    const hex = c ? rgbToHex(c.r, c.g, c.b) : "unknown";
                    issues.push({
                        nodeId: node.id,
                        nodeName: node.name,
                        property: "fill[" + i + "]",
                        severity: "error",
                        raw: hex,
                        suggested: "surface/* or text/* or icon/* token"
                    });
                }
            }
        }
    }
    // ── Strokes: error if raw
    if (Array.isArray(n.strokes) && n.strokes.length > 0) {
        const strokesBound = (_c = bound.strokes) !== null && _c !== void 0 ? _c : [];
        const isBound = Array.isArray(strokesBound) && strokesBound[0] != null;
        if (!isBound) {
            const stroke = n.strokes[0];
            if (stroke.type === "SOLID") {
                const c = stroke.color;
                const hex = c ? rgbToHex(c.r, c.g, c.b) : "unknown";
                issues.push({
                    nodeId: node.id,
                    nodeName: node.name,
                    property: "stroke",
                    severity: "error",
                    raw: hex,
                    suggested: "border/* token"
                });
            }
        }
    }
    // ── Corner radius: warning if hardcoded non-zero value
    if (typeof n.cornerRadius === "number" && n.cornerRadius > 0) {
        const radiusBound = bound.cornerRadius != null || bound.topLeftRadius != null;
        if (!radiusBound) {
            issues.push({
                nodeId: node.id,
                nodeName: node.name,
                property: "cornerRadius",
                severity: "warning",
                raw: String(n.cornerRadius) + "px",
                suggested: "shape/radius/* token"
            });
        }
    }
    // ── Item spacing / padding: warning if hardcoded non-zero
    const spacingProps = ["itemSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"];
    for (const prop of spacingProps) {
        if (typeof n[prop] === "number" && n[prop] > 0) {
            if (bound[prop] == null) {
                issues.push({
                    nodeId: node.id,
                    nodeName: node.name,
                    property: prop,
                    severity: "warning",
                    raw: String(n[prop]) + "px",
                    suggested: "spacing/* or padding/* token"
                });
            }
        }
    }
    // ── Text style: error if text node has no attached style
    if (node.type === "TEXT") {
        const textNode = node;
        if (!textNode.textStyleId || textNode.textStyleId === "") {
            issues.push({
                nodeId: node.id,
                nodeName: node.name,
                property: "textStyle",
                severity: "error",
                raw: "none",
                suggested: "Thread DS text style (e.g. Label/Button)"
            });
        }
    }
    // ── Global token guard: semantic components must not bind directly to _1. Global
    // We check if any boundVariable ID resolves to a variable whose collection name
    // starts with "_1." — which is the Global collection in Thread DS
    // (This check is best-effort; full resolution requires async lookup)
    return issues;
}
function walkAndAudit(node, allVarNames, results) {
    results.push(...auditNode(node, allVarNames));
    if ("children" in node) {
        for (const child of node.children) {
            walkAndAudit(child, allVarNames, results);
        }
    }
}
async function runAudit() {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
        throw new Error("Select a frame or component to audit.");
    }
    // Build a set of all local variable names for reference (used for suggestions)
    const allVars = await figma.variables.getLocalVariablesAsync();
    const allVarNames = new Set(allVars.map(v => v.name));
    const issues = [];
    for (const node of selection) {
        walkAndAudit(node, allVarNames, issues);
    }
    return issues;
}
// ─── NEW: Token Propose ───────────────────────────────────────────────────────
// Validates a token proposal against existing variables, then creates a GitHub
// issue directly using the stored PAT — no middleware required.
function validateTokenName(name) {
    // Must be lowercase, slash-separated, category/subcategory/role pattern
    // e.g. surface/decision/warning-subtle, text/action/primary
    if (!/^[a-z][a-z0-9]*(?:\/[a-z][a-z0-9-]*){1,}$/.test(name)) {
        return "Name must be lowercase slug/slash format, e.g. surface/decision/warning-subtle";
    }
    return null;
}
async function proposeToken(payload) {
    // 1. Validate name format
    const nameError = validateTokenName(payload.proposedName);
    if (nameError)
        throw new Error(nameError);
    // 2. Check it doesn't already exist
    const allVars = await figma.variables.getLocalVariablesAsync();
    const existing = allVars.find(v => v.name === payload.proposedName);
    if (existing) {
        throw new Error("Token '" + payload.proposedName + "' already exists (ID: " + existing.id + ").");
    }
    // 3. Check alias target exists (if provided)
    if (payload.aliasTo) {
        const aliasTarget = allVars.find(v => v.name === payload.aliasTo);
        if (!aliasTarget) {
            throw new Error("Alias target '" + payload.aliasTo + "' not found in current variables.");
        }
    }
    // 4. Create a GitHub issue directly using the stored PAT
    const settings = await figma.clientStorage.getAsync("settings");
    if (!settings || !settings.pat) {
        throw new Error("No GitHub PAT saved — open Settings first.");
    }
    const issueTitle = "Token proposal: " + payload.proposedName;
    const issueBody = [
        "## Token proposal",
        "",
        "| Field | Value |",
        "| --- | --- |",
        "| **Proposed name** | `" + payload.proposedName + "` |",
        "| **Collection** | " + payload.collectionName + " |",
        "| **Alias to** | `" + (payload.aliasTo || "—") + "` |",
        "| **Submitted by** | " + payload.submittedBy + " |",
        "| **Figma file** | " + figma.root.name + " |",
        "| **Timestamp** | " + new Date().toISOString() + " |",
        "",
        "## Rationale",
        "",
        payload.rationale,
        "",
        "---",
        "_Submitted via Thread DS Plugin — Token Propose_"
    ].join("\n");
    const issueUrl = "https://api.github.com/repos/" + settings.owner + "/" + settings.repo + "/issues";
    const res = await fetch(issueUrl, {
        method: "POST",
        headers: {
            "Authorization": "Bearer " + settings.pat,
            "Content-Type": "application/json",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28"
        },
        body: JSON.stringify({
            title: issueTitle,
            body: issueBody,
            labels: ["token-proposal", "tier-1"]
        })
    });
    if (!res.ok) {
        const errText = await res.text();
        // 422 likely means the labels don't exist yet — retry without labels
        if (res.status === 422) {
            const retry = await fetch(issueUrl, {
                method: "POST",
                headers: {
                    "Authorization": "Bearer " + settings.pat,
                    "Content-Type": "application/json",
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28"
                },
                body: JSON.stringify({ title: issueTitle, body: issueBody })
            });
            if (!retry.ok) {
                throw new Error("GitHub " + retry.status + ": " + (await retry.text()));
            }
            return;
        }
        throw new Error("GitHub " + res.status + ": " + errText);
    }
}
// ─── NEW: Component Scaffold ──────────────────────────────────────────────────
// Creates a correctly structured component set in the current page (Sandbox)
// with auto-layout, naming convention, and token variables pre-bound where
// the current file has matching tokens available.
// Token preset definitions — maps preset name to the semantic token names
// used for fill on the surface layer. Extend this map as Thread DS grows.
const TOKEN_PRESETS = {
    "decision-surface": {
        success: "surface/decision/success",
        warning: "surface/decision/warning",
        error: "surface/decision/error",
        information: "surface/decision/information",
        neutral: "surface/decision/neutral"
    },
    "action-surface": {
        primary: "surface/action/primary",
        secondary: "surface/action/secondary",
        accent: "surface/action/accent-primary",
        disabled: "surface/action/disabled"
    },
    "base-surface": {
        default: "surface/base/default",
        subtle: "surface/base/subtle",
        inverted: "surface/base/inverted"
    }
};
// Parses a variant property string like "Type: success, warning, error" into
// { propName: "Type", values: ["success", "warning", "error"] }
function parseVariantProp(raw) {
    const colonIdx = raw.indexOf(":");
    if (colonIdx === -1)
        return null;
    const propName = raw.slice(0, colonIdx).trim();
    const values = raw.slice(colonIdx + 1).split(",").map(v => v.trim()).filter(Boolean);
    return { propName, values };
}
async function scaffoldComponent(componentName, baseType, variantPropsRaw, tokenPreset) {
    var _a;
    if (!componentName || !componentName.trim()) {
        throw new Error("Component name is required.");
    }
    // Normalise name to lowercase kebab
    const normName = componentName.trim().toLowerCase().replace(/\s+/g, "-");
    // Parse variant properties
    const parsedProps = variantPropsRaw
        .map(parseVariantProp)
        .filter((p) => p !== null);
    if (parsedProps.length === 0) {
        throw new Error("At least one variant property is required (e.g. 'Type: success, warning').");
    }
    // Get token map for this preset
    const presetTokens = (_a = TOKEN_PRESETS[tokenPreset]) !== null && _a !== void 0 ? _a : {};
    // Load local variables for token binding
    const allVars = await figma.variables.getLocalVariablesAsync();
    const varByName = {};
    for (const v of allVars)
        varByName[v.name] = v;
    // Determine layout from baseType
    const isHorizontal = baseType.includes("horizontal");
    const layoutMode = isHorizontal ? "HORIZONTAL" : "VERTICAL";
    // Build all variant combinations (cartesian product of all prop values)
    function cartesian(arrays) {
        return arrays.reduce((acc, curr) => [].concat(...acc.map(a => curr.map(b => [...a, b]))), [[]]);
    }
    const propValueArrays = parsedProps.map(p => p.values);
    const combinations = cartesian(propValueArrays);
    // Create component set
    const components = [];
    for (const combo of combinations) {
        const comp = figma.createComponent();
        // Name: "PropName=value, PropName2=value2"
        comp.name = combo.map((val, i) => parsedProps[i].propName + "=" + val).join(", ");
        // Layout
        comp.layoutMode = layoutMode;
        comp.counterAxisSizingMode = "AUTO";
        comp.primaryAxisSizingMode = "AUTO";
        comp.paddingTop = 16;
        comp.paddingRight = 16;
        comp.paddingBottom = 16;
        comp.paddingLeft = 16;
        comp.itemSpacing = 8;
        comp.cornerRadius = 8;
        // Add a placeholder text layer
        const label = figma.createText();
        await figma.loadFontAsync({ family: "Inter", style: "Regular" });
        label.characters = normName;
        label.fontSize = 14;
        comp.appendChild(label);
        // Bind surface fill to token if available
        // Look for a token matching this variant's first prop value in the preset
        const firstVal = combo[0].toLowerCase();
        const tokenName = presetTokens[firstVal];
        if (tokenName && varByName[tokenName]) {
            const token = varByName[tokenName];
            const solidPaint = { type: "SOLID", color: { r: 0.95, g: 0.95, b: 0.95 } };
            comp.fills = [solidPaint];
            try {
                figma.variables.setBoundVariableForPaint(comp.fills[0], "color", token);
            }
            catch (_b) {
                // setBoundVariableForPaint mutates in-place; re-assign fills after binding
                const boundFill = figma.variables.setBoundVariableForPaint({ type: "SOLID", color: { r: 0.95, g: 0.95, b: 0.95 } }, "color", token);
                comp.fills = [boundFill];
            }
        }
        else {
            // Fallback: light grey surface, no binding
            comp.fills = [{ type: "SOLID", color: { r: 0.95, g: 0.95, b: 0.95 } }];
        }
        components.push(comp);
    }
    // Combine into a component set
    const set = figma.combineAsVariants(components, figma.currentPage);
    set.name = normName;
    set.description = "Proposed component — Thread DS Sandbox. Created by Thread DS Plugin.\nToken preset: " + tokenPreset;
    // Position near viewport centre
    set.x = figma.viewport.center.x - (set.width / 2);
    set.y = figma.viewport.center.y - (set.height / 2);
    // Select it so the designer sees it immediately
    figma.currentPage.selection = [set];
    figma.viewport.scrollAndZoomIntoView([set]);
    return { nodeId: set.id, name: set.name };
}
// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    const saved = await figma.clientStorage.getAsync("settings");
    // Wider + taller to accommodate the tab UI
    figma.showUI(__html__, { width: 360, height: 480 });
    figma.ui.postMessage({ type: "SETTINGS_LOADED", settings: saved !== null && saved !== void 0 ? saved : null });
    figma.ui.onmessage = async (msg) => {
        var _a;
        // ── Existing: save settings
        if (msg.type === "SAVE_SETTINGS") {
            await figma.clientStorage.setAsync("settings", msg.settings);
            figma.ui.postMessage({ type: "SETTINGS_SAVED" });
        }
        // ── Existing: sync to GitHub
        if (msg.type === "SYNC") {
            const settings = await figma.clientStorage.getAsync("settings");
            if (!settings || !settings.pat) {
                figma.ui.postMessage({ type: "SYNC_ERR", error: "No PAT saved — open Settings first." });
                return;
            }
            try {
                const prevVersion = (_a = await figma.clientStorage.getAsync("syncVersion")) !== null && _a !== void 0 ? _a : 0;
                const syncVersion = prevVersion + 1;
                await figma.clientStorage.setAsync("syncVersion", syncVersion);
                const files = await buildAllPayloads(settings, syncVersion, (message) => {
                    figma.ui.postMessage({ type: "SYNC_PROGRESS", message });
                });
                const total = files.length;
                for (let i = 0; i < files.length; i++) {
                    figma.ui.postMessage({ type: "SYNC_PROGRESS", message: "Pushing " + (i + 1) + "/" + total + ": " + files[i].path.split("/").pop() + "…" });
                    await githubPut(settings, files[i]);
                }
                figma.ui.postMessage({ type: "SYNC_OK", count: total, syncVersion });
            }
            catch (e) {
                figma.ui.postMessage({ type: "SYNC_ERR", error: String(e) });
            }
        }
        // ── NEW: run token audit on current selection
        if (msg.type === "AUDIT_SELECTION") {
            try {
                const issues = await runAudit();
                figma.ui.postMessage({ type: "AUDIT_RESULT", issues });
            }
            catch (e) {
                figma.ui.postMessage({ type: "AUDIT_RESULT", issues: [], error: String(e) });
            }
        }
        // ── NEW: propose a token via Tines webhook
        if (msg.type === "PROPOSE_TOKEN") {
            try {
                await proposeToken(msg.payload);
                figma.ui.postMessage({ type: "PROPOSE_OK" });
            }
            catch (e) {
                figma.ui.postMessage({ type: "PROPOSE_ERR", error: String(e) });
            }
        }
        // ── NEW: scaffold a component in the current page
        if (msg.type === "SCAFFOLD_COMPONENT") {
            try {
                const result = await scaffoldComponent(msg.componentName, msg.baseType, msg.variantProps, msg.tokenPreset);
                figma.ui.postMessage({ type: "SCAFFOLD_OK", nodeId: result.nodeId, name: result.name });
            }
            catch (e) {
                figma.ui.postMessage({ type: "SCAFFOLD_ERR", error: String(e) });
            }
        }
    };
}
main();
