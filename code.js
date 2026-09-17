"use strict";
// ─── Base64 (UTF-8 safe) ─────────────────────────────────────────────────────
function toBase64(str) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        // Surrogate pair (e.g. emoji) — combine into one code point and emit
        // a 4-byte UTF-8 sequence instead of encoding each half separately.
        if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
            const low = str.charCodeAt(i + 1);
            if (low >= 0xdc00 && low <= 0xdfff) {
                const codePoint = 0x10000 + (c - 0xd800) * 0x400 + (low - 0xdc00);
                bytes.push(240 | (codePoint >> 18));
                bytes.push(128 | ((codePoint >> 12) & 63));
                bytes.push(128 | ((codePoint >> 6) & 63));
                bytes.push(128 | (codePoint & 63));
                i++;
                continue;
            }
        }
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
function fromBase64(b64) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const clean = b64.replace(/[\r\n]/g, "");
    const bytes = [];
    let buffer = 0, bits = 0;
    for (const ch of clean) {
        if (ch === "=")
            break;
        const val = chars.indexOf(ch);
        if (val === -1)
            continue;
        buffer = (buffer << 6) | val;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            bytes.push((buffer >> bits) & 0xff);
        }
    }
    let out = "";
    let i = 0;
    while (i < bytes.length) {
        const b0 = bytes[i++];
        if (b0 < 128) {
            out += String.fromCharCode(b0);
        }
        else if (b0 >> 5 === 0b110) {
            const b1 = bytes[i++];
            out += String.fromCharCode(((b0 & 0x1f) << 6) | (b1 & 0x3f));
        }
        else if (b0 >> 4 === 0b1110) {
            const b1 = bytes[i++], b2 = bytes[i++];
            out += String.fromCharCode(((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f));
        }
        else if (b0 >> 3 === 0b11110) {
            const b1 = bytes[i++], b2 = bytes[i++], b3 = bytes[i++];
            const codePoint = ((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
            const adjusted = codePoint - 0x10000;
            out += String.fromCharCode(0xd800 + (adjusted >> 10), 0xdc00 + (adjusted & 0x3ff));
        }
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
async function fetchGithubJson(settings, path) {
    const url = "https://api.github.com/repos/" + settings.owner + "/" + settings.repo + "/contents/" + path + "?ref=" + settings.branch;
    const res = await fetch(url, {
        headers: {
            "Authorization": "Bearer " + settings.pat,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28"
        }
    });
    if (!res.ok)
        return null;
    const json = await res.json();
    try {
        return JSON.parse(fromBase64(json.content));
    }
    catch (_a) {
        return null;
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
// ─── Deep anatomy: variable resolution ────────────────────────────────────────
// boundVariables on a node only carry a variable id. Components reference
// variables published from the separate Tokens file, so they show up as
// library variables here rather than local ones — getVariableByIdAsync
// resolves both, which is why we look names up this way instead of building
// a name map from getLocalVariablesAsync().
const varNameCache = new Map();
async function resolveVarName(id) {
    var _a;
    if (varNameCache.has(id))
        return varNameCache.get(id);
    let name = "";
    try {
        const v = await figma.variables.getVariableByIdAsync(id);
        name = (_a = v === null || v === void 0 ? void 0 : v.name) !== null && _a !== void 0 ? _a : "";
    }
    catch (_b) {
        name = "";
    }
    varNameCache.set(id, name);
    return name;
}
async function resolveVarRef(alias) {
    if (!alias || typeof alias !== "object" || !("id" in alias))
        return null;
    const id = alias.id;
    const name = await resolveVarName(id);
    return { id, name };
}
// ─── Deep anatomy: fill / stroke serialiser ───────────────────────────────────
async function serialisePaintsDeep(paints, boundPaints) {
    var _a, _b, _c, _d;
    if (!Array.isArray(paints))
        return [];
    const boundArr = Array.isArray(boundPaints) ? boundPaints : [];
    const out = [];
    for (let i = 0; i < paints.length; i++) {
        const p = paints[i];
        if (p.type !== "SOLID") {
            out.push({ type: p.type, visible: (_a = p.visible) !== null && _a !== void 0 ? _a : true });
            continue;
        }
        const c = p.color;
        const boundColor = (_b = boundArr[i]) === null || _b === void 0 ? void 0 : _b.color;
        out.push({
            type: "SOLID",
            hex: rgbToHex(c.r, c.g, c.b),
            opacity: (_c = p.opacity) !== null && _c !== void 0 ? _c : 1,
            visible: (_d = p.visible) !== null && _d !== void 0 ? _d : true,
            boundVariable: await resolveVarRef(boundColor)
        });
    }
    return out;
}
// ─── Deep anatomy: auto-layout serialiser ─────────────────────────────────────
async function serialiseLayoutDeep(n, bound) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    if (n.layoutMode === undefined)
        return null;
    return {
        layoutMode: (_a = n.layoutMode) !== null && _a !== void 0 ? _a : "NONE",
        primaryAxisAlignItems: (_b = n.primaryAxisAlignItems) !== null && _b !== void 0 ? _b : "MIN",
        counterAxisAlignItems: (_c = n.counterAxisAlignItems) !== null && _c !== void 0 ? _c : "MIN",
        itemSpacing: (_d = n.itemSpacing) !== null && _d !== void 0 ? _d : 0,
        paddingTop: (_e = n.paddingTop) !== null && _e !== void 0 ? _e : 0,
        paddingRight: (_f = n.paddingRight) !== null && _f !== void 0 ? _f : 0,
        paddingBottom: (_g = n.paddingBottom) !== null && _g !== void 0 ? _g : 0,
        paddingLeft: (_h = n.paddingLeft) !== null && _h !== void 0 ? _h : 0,
        cornerRadius: typeof n.cornerRadius === "number" ? n.cornerRadius : null,
        boundVariables: {
            itemSpacing: await resolveVarRef(bound.itemSpacing),
            paddingTop: await resolveVarRef(bound.paddingTop),
            paddingRight: await resolveVarRef(bound.paddingRight),
            paddingBottom: await resolveVarRef(bound.paddingBottom),
            paddingLeft: await resolveVarRef(bound.paddingLeft),
            cornerRadius: await resolveVarRef(bound.cornerRadius)
        }
    };
}
// ─── Deep anatomy: text layer serialiser ──────────────────────────────────────
async function serialiseTextDeep(node, bound) {
    const lineHeight = node.lineHeight;
    const letterSpacing = node.letterSpacing;
    return {
        characters: node.characters,
        textStyleId: typeof node.textStyleId === "string" ? node.textStyleId : "",
        fontSize: typeof node.fontSize === "number" ? node.fontSize : null,
        fontName: (typeof node.fontName === "object" && node.fontName && "family" in node.fontName) ? node.fontName : null,
        lineHeight: (typeof lineHeight === "object" && lineHeight && "value" in lineHeight) ? lineHeight.value : null,
        letterSpacing: (typeof letterSpacing === "object" && letterSpacing && "value" in letterSpacing) ? letterSpacing.value : null,
        boundVariables: {
            fontSize: await resolveVarRef(bound.fontSize),
            lineHeight: await resolveVarRef(bound.lineHeight),
            letterSpacing: await resolveVarRef(bound.letterSpacing),
            fontWeight: await resolveVarRef(bound.fontWeight)
        }
    };
}
// ─── Deep anatomy: recursive layer walker ─────────────────────────────────────
async function serialiseLayerDeep(node) {
    var _a, _b;
    const n = node;
    const bound = (_a = n.boundVariables) !== null && _a !== void 0 ? _a : {};
    const layer = {
        id: node.id,
        name: node.name,
        type: node.type,
        visible: node.visible
    };
    const layout = await serialiseLayoutDeep(n, bound);
    if (layout)
        layer.layout = layout;
    if (Array.isArray(n.fills)) {
        layer.fills = await serialisePaintsDeep(n.fills, bound.fills);
    }
    if (Array.isArray(n.strokes) && n.strokes.length > 0) {
        layer.strokes = await serialisePaintsDeep(n.strokes, bound.strokes);
        layer.strokeWeight = (_b = n.strokeWeight) !== null && _b !== void 0 ? _b : null;
    }
    if (node.type === "TEXT") {
        layer.text = await serialiseTextDeep(node, bound);
    }
    if ("children" in node) {
        const children = [];
        for (const child of node.children) {
            children.push(await serialiseLayerDeep(child));
        }
        layer.children = children;
    }
    return layer;
}
// ─── Deep anatomy: platform behaviour convention parser ───────────────────────
// Designers add lines like "Web: ..." / "iOS: ..." / "Android: ..." to a
// component set's description in Figma; we lift them into structured
// platform guidance instead of leaving them as free text.
function parsePlatformGuidance(description) {
    const guidance = { web: "", ios: "", android: "" };
    const patterns = [
        ["web", /^web\s*:\s*/i],
        ["ios", /^ios\s*:\s*/i],
        ["android", /^android\s*:\s*/i]
    ];
    for (const rawLine of description.split("\n")) {
        const line = rawLine.trim();
        for (const [key, re] of patterns) {
            if (re.test(line)) {
                guidance[key] = line.replace(re, "").trim();
            }
        }
    }
    return guidance;
}
// ─── Deep anatomy: per-variant component-set serialiser ───────────────────────
async function serialiseComponentSetDeep(node) {
    var _a, _b, _c, _d;
    const variantNodes = ((_a = node.children) !== null && _a !== void 0 ? _a : []).filter((c) => c.type === "COMPONENT");
    const variants = [];
    for (const v of variantNodes) {
        variants.push({
            id: v.id,
            key: v.key,
            name: v.name,
            variantProperties: (_b = v.variantProperties) !== null && _b !== void 0 ? _b : {},
            anatomy: await serialiseLayerDeep(v)
        });
    }
    return {
        id: node.id,
        key: node.key,
        name: node.name,
        type: node.type,
        description: node.description || "",
        platformGuidance: parsePlatformGuidance(node.description || ""),
        componentPropertyDefinitions: (_c = node.componentPropertyDefinitions) !== null && _c !== void 0 ? _c : {},
        variantGroupProperties: (_d = node.variantGroupProperties) !== null && _d !== void 0 ? _d : {},
        variants
    };
}
// ─── Export SVG for a single node ─────────────────────────────────────────────
async function exportSvgFromNode(node) {
    try {
        const bytes = await node.exportAsync({ format: "SVG_STRING" });
        if (typeof bytes === "string")
            return bytes;
        return String.fromCharCode(...Array.from(bytes));
    }
    catch (_a) {
        return "";
    }
}
// ─── Export SVG thumbnail for component set (uses first child) ────────────────
async function exportSvg(node) {
    if (!node.children || node.children.length === 0)
        return "";
    return exportSvgFromNode(node.children[0]);
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    const tag = " [sync #" + syncVersion + "]";
    const now = new Date().toISOString();
    const files = [];
    // ── Detect which Figma file we're running from.
    // Tokens, Components and Icons each live in their own separate Figma file
    // (see thread-ds-context.md), so the plugin behaves differently per file.
    const fileName = figma.root.name;
    const isTokensFile = /token/i.test(fileName);
    const isIconsFile = !isTokensFile && /icon/i.test(fileName);
    const isComponentsFile = !isTokensFile && !isIconsFile;
    onProgress("Detected file: " + fileName + " → " + (isTokensFile ? "Tokens mode" : isIconsFile ? "Icons mode" : "Components mode"));
    if (isTokensFile) {
        // ── Tokens file: export variables and text styles only
        onProgress("Exporting variables…");
        const variables = await exportVariables();
        files.push({
            path: "packages/tokens/exports/figma-variables.json",
            content: JSON.stringify(variables, null, 2),
            message: "chore: sync figma variables" + tag + tag
        });
        onProgress("Exporting text styles…");
        const textStyles = await exportTextStyles();
        files.push({
            path: "docs/figma-make/text-styles.json",
            content: JSON.stringify(textStyles, null, 2),
            message: "chore: sync text-styles.json" + tag + tag
        });
        return files;
    }
    if (isIconsFile) {
        // ── Icons file: every component set in this file is an icon
        onProgress("Loading all pages…");
        await figma.loadAllPagesAsync();
        onProgress("Scanning icons…");
        const iconSets = findAllComponentSets(figma.root);
        onProgress("Building icons.json (" + iconSets.length + " icon sets)…");
        const iconsData = iconSets.map(serialiseComponentSet);
        files.push({
            path: "docs/figma-make/icons.json",
            content: JSON.stringify(iconsData, null, 2),
            message: "chore: sync icons.json" + tag + tag
        });
        onProgress("Building icon groups…");
        const groupMap = {};
        for (let i = 0; i < iconSets.length; i++) {
            const node = iconSets[i];
            const groupId = node.name.split("/")[0].toLowerCase().replace(/\s+/g, "-");
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
        return files;
    }
    // ── Components file: export components, anatomy, render specs and the token audit
    onProgress("Loading all pages…");
    await figma.loadAllPagesAsync();
    onProgress("Scanning components…");
    const componentSets = findAllComponentSets(figma.root).filter((n) => !n.name.startsWith("_"));
    // ── components.json
    onProgress("Building components.json (" + componentSets.length + " components)…");
    const componentsData = componentSets.map(serialiseComponentSet);
    files.push({
        path: "docs/figma-make/components.json",
        content: JSON.stringify(componentsData, null, 2),
        message: "chore: sync components.json" + tag + tag
    });
    // ── component-anatomy.json (deep: full per-variant layer tree + bound variables)
    onProgress("Building deep component anatomy (" + componentSets.length + " components)…");
    const deepAnatomyComponents = [];
    for (let i = 0; i < componentSets.length; i++) {
        onProgress("Anatomy " + (i + 1) + "/" + componentSets.length + ": " + componentSets[i].name + "…");
        deepAnatomyComponents.push(await serialiseComponentSetDeep(componentSets[i]));
    }
    files.push({
        path: "docs/figma-make/component-anatomy.json",
        content: JSON.stringify({
            schema: "thread.ds.component-anatomy.v3",
            generatedAt: now,
            source: { fileKey: "", fileName: figma.root.name },
            detailLevel: "full",
            components: deepAnatomyComponents
        }, null, 2),
        message: "chore: sync component-anatomy.json" + tag + tag
    });
    // ── component-render-specs.json (with per-variant SVG thumbnails)
    onProgress("Exporting component SVG thumbnails…");
    const renderSpecComponents = [];
    for (let i = 0; i < componentSets.length; i++) {
        const node = componentSets[i];
        onProgress("SVG " + (i + 1) + "/" + componentSets.length + ": " + node.name + "…");
        // Component-level thumbnail (canonical/first variant)
        const svgThumbnail = await exportSvg(node);
        // Per-variant SVG thumbnails
        const variantNodes = ((_a = node.children) !== null && _a !== void 0 ? _a : []).filter((c) => c.type === "COMPONENT");
        const variants = [];
        for (let j = 0; j < variantNodes.length; j++) {
            const variantNode = variantNodes[j];
            onProgress("SVG " + (i + 1) + "/" + componentSets.length +
                " · variant " + (j + 1) + "/" + variantNodes.length +
                ": " + variantNode.name + "…");
            const variantSvg = await exportSvgFromNode(variantNode);
            variants.push({
                id: variantNode.id,
                key: variantNode.key,
                name: variantNode.name,
                variantProperties: (_b = variantNode.variantProperties) !== null && _b !== void 0 ? _b : {},
                svgThumbnail: variantSvg
            });
        }
        renderSpecComponents.push({
            id: node.id,
            key: node.key,
            name: node.name,
            description: node.description || "",
            componentPropertyDefinitions: (_c = node.componentPropertyDefinitions) !== null && _c !== void 0 ? _c : {},
            variantGroupProperties: (_d = node.variantGroupProperties) !== null && _d !== void 0 ? _d : {},
            canonicalVariantId: (_f = (_e = variantNodes[0]) === null || _e === void 0 ? void 0 : _e.id) !== null && _f !== void 0 ? _f : node.id,
            canonicalVariantName: (_h = (_g = variantNodes[0]) === null || _g === void 0 ? void 0 : _g.name) !== null && _h !== void 0 ? _h : "",
            svgThumbnail,
            variants
        });
    }
    files.push({
        path: "docs/figma-make/component-render-specs.json",
        content: JSON.stringify({
            schema: "thread.ds.component-render-specs.v1",
            generatedAt: now,
            source: { fileKey: "", fileName: figma.root.name },
            note: "Full render spec: per-variant SVG thumbnails + variant metadata.",
            components: renderSpecComponents
        }, null, 2),
        message: "chore: sync component-render-specs.json" + tag + tag
    });
    // ── token-audit.json (automated — every component set, not just the current selection)
    onProgress("Running token audit across all components…");
    const tokenAuditIssues = [];
    for (const set of componentSets) {
        for (const variant of set.children) {
            walkAndAudit(variant, new Set(), tokenAuditIssues);
        }
    }
    files.push({
        path: "docs/figma-make/token-audit.json",
        content: JSON.stringify({
            schema: "thread.ds.token-audit.v1",
            generatedAt: now,
            issueCount: tokenAuditIssues.length,
            issues: tokenAuditIssues
        }, null, 2),
        message: "chore: sync token-audit.json" + tag + tag
    });
    // ── Pull last-published data for design-contract.json. Variables/text
    // styles live in the Tokens file and icons live in the Icons file — neither
    // is available locally from a Components-file run, so we read back what
    // each of those files' own sync last published.
    onProgress("Fetching published token and icon data for design-contract.json…");
    const variables = (_j = (await fetchGithubJson(settings, "packages/tokens/exports/figma-variables.json"))) !== null && _j !== void 0 ? _j : { collections: [], modes: [], variables: [] };
    const textStyles = (_k = (await fetchGithubJson(settings, "docs/figma-make/text-styles.json"))) !== null && _k !== void 0 ? _k : [];
    const iconsIndex = (_l = (await fetchGithubJson(settings, "docs/figma-make/icons.index.json"))) !== null && _l !== void 0 ? _l : { total: 0, groups: [] };
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
                iconsIndex: "docs/figma-make/icons.index.json",
                tokenAudit: "docs/figma-make/token-audit.json"
            },
            summary: {
                collections: variables.collections.length,
                modes: variables.modes.length,
                variables: variables.variables.length,
                components: componentSets.length,
                component_anatomy: componentSets.length,
                component_render_specs: componentSets.length,
                text_styles: textStyles.length,
                icons: iconsIndex.total,
                icon_groups: iconsIndex.groups.length,
                token_audit_issues: tokenAuditIssues.length
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
// ─── Token Audit ──────────────────────────────────────────────────────────────
function rgbToHex(r, g, b) {
    const toHex = (n) => Math.round(n * 255).toString(16).padStart(2, "0");
    return "#" + toHex(r) + toHex(g) + toHex(b);
}
function auditNode(node, allVarNames) {
    var _a, _b, _c;
    const issues = [];
    const n = node;
    const bound = (_a = n.boundVariables) !== null && _a !== void 0 ? _a : {};
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
    return issues;
}
function walkAndAudit(node, allVarNames, results) {
    // Skip hidden layers
    if (!node.visible)
        return;
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
    const allVars = await figma.variables.getLocalVariablesAsync();
    const allVarNames = new Set(allVars.map(v => v.name));
    const issues = [];
    for (const node of selection) {
        walkAndAudit(node, allVarNames, issues);
    }
    return issues;
}
// ─── Token Value Check ───────────────────────────────────────────────────────
async function checkTokenValueExists(proposedValue, collectionName) {
    const allVars = await figma.variables.getLocalVariablesAsync();
    const allCollections = await figma.variables.getLocalVariableCollectionsAsync();
    // Parse the proposed value as a number (strip px, spaces etc)
    const numericValue = parseFloat(proposedValue.replace(/[^0-9.]/g, ""));
    if (isNaN(numericValue))
        return { exists: false };
    // Find the matching collection by name (case-insensitive partial match)
    const collection = allCollections.find(c => c.name.toLowerCase().includes(collectionName.toLowerCase()) ||
        collectionName.toLowerCase().includes(c.name.toLowerCase()));
    const collectionId = collection ? collection.id : null;
    for (const variable of allVars) {
        // Only check variables in the relevant collection if we found one
        if (collectionId && variable.variableCollectionId !== collectionId)
            continue;
        // Only check FLOAT type variables (spacing, radius etc)
        if (variable.resolvedType !== "FLOAT")
            continue;
        for (const modeId of Object.keys(variable.valuesByMode)) {
            const val = variable.valuesByMode[modeId];
            if (typeof val === "number" && val === numericValue) {
                return { exists: true, matchingToken: variable.name };
            }
        }
    }
    return { exists: false };
}
// ─── Token Propose ────────────────────────────────────────────────────────────
function validateTokenName(name) {
    if (!/^[a-z][a-z0-9]*(?:\/[a-z][a-z0-9-]*){1,}$/.test(name)) {
        return "Name must be lowercase slug/slash format, e.g. surface/decision/warning-subtle";
    }
    return null;
}
async function proposeToken(payload) {
    const nameError = validateTokenName(payload.proposedName);
    if (nameError)
        throw new Error(nameError);
    const allVars = await figma.variables.getLocalVariablesAsync();
    const existing = allVars.find(v => v.name === payload.proposedName);
    if (existing) {
        throw new Error("Token '" + payload.proposedName + "' already exists (ID: " + existing.id + ").");
    }
    // Check if a token with this value already exists in the same collection
    if (payload.proposedValue) {
        const valueCheck = await checkTokenValueExists(payload.proposedValue, payload.collectionName);
        if (valueCheck.exists) {
            throw new Error("A token with this value already exists in Thread DS: '" + valueCheck.matchingToken + "'. " +
                "Use the existing token instead of creating a new one.");
        }
    }
    if (payload.aliasTo) {
        const aliasTarget = allVars.find(v => v.name === payload.aliasTo);
        if (!aliasTarget) {
            throw new Error("Alias target '" + payload.aliasTo + "' not found in current variables.");
        }
    }
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
// ─── Component Scaffold ───────────────────────────────────────────────────────
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
    const normName = componentName.trim().toLowerCase().replace(/\s+/g, "-");
    const parsedProps = variantPropsRaw
        .map(parseVariantProp)
        .filter((p) => p !== null);
    if (parsedProps.length === 0) {
        throw new Error("At least one variant property is required (e.g. 'Type: success, warning').");
    }
    const presetTokens = (_a = TOKEN_PRESETS[tokenPreset]) !== null && _a !== void 0 ? _a : {};
    const allVars = await figma.variables.getLocalVariablesAsync();
    const varByName = {};
    for (const v of allVars)
        varByName[v.name] = v;
    const isHorizontal = baseType.includes("horizontal");
    const layoutMode = isHorizontal ? "HORIZONTAL" : "VERTICAL";
    function cartesian(arrays) {
        return arrays.reduce((acc, curr) => [].concat(...acc.map(a => curr.map(b => [...a, b]))), [[]]);
    }
    const propValueArrays = parsedProps.map(p => p.values);
    const combinations = cartesian(propValueArrays);
    const components = [];
    for (const combo of combinations) {
        const comp = figma.createComponent();
        comp.name = combo.map((val, i) => parsedProps[i].propName + "=" + val).join(", ");
        comp.layoutMode = layoutMode;
        comp.counterAxisSizingMode = "AUTO";
        comp.primaryAxisSizingMode = "AUTO";
        comp.paddingTop = 16;
        comp.paddingRight = 16;
        comp.paddingBottom = 16;
        comp.paddingLeft = 16;
        comp.itemSpacing = 8;
        comp.cornerRadius = 8;
        const label = figma.createText();
        await figma.loadFontAsync({ family: "Inter", style: "Regular" });
        label.characters = normName;
        label.fontSize = 14;
        comp.appendChild(label);
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
                const boundFill = figma.variables.setBoundVariableForPaint({ type: "SOLID", color: { r: 0.95, g: 0.95, b: 0.95 } }, "color", token);
                comp.fills = [boundFill];
            }
        }
        else {
            comp.fills = [{ type: "SOLID", color: { r: 0.95, g: 0.95, b: 0.95 } }];
        }
        components.push(comp);
    }
    const set = figma.combineAsVariants(components, figma.currentPage);
    set.name = normName;
    set.description = "Proposed component — Thread DS Sandbox. Created by Thread DS Plugin.\nToken preset: " + tokenPreset;
    set.x = figma.viewport.center.x - (set.width / 2);
    set.y = figma.viewport.center.y - (set.height / 2);
    figma.currentPage.selection = [set];
    figma.viewport.scrollAndZoomIntoView([set]);
    return { nodeId: set.id, name: set.name };
}
// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    const saved = await figma.clientStorage.getAsync("settings");
    figma.showUI(__html__, { width: 360, height: 480 });
    figma.ui.postMessage({ type: "SETTINGS_LOADED", settings: saved !== null && saved !== void 0 ? saved : null });
    figma.ui.onmessage = async (msg) => {
        var _a;
        if (msg.type === "SAVE_SETTINGS") {
            await figma.clientStorage.setAsync("settings", msg.settings);
            figma.ui.postMessage({ type: "SETTINGS_SAVED" });
        }
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
        if (msg.type === "AUDIT_SELECTION") {
            try {
                const issues = await runAudit();
                figma.ui.postMessage({ type: "AUDIT_RESULT", issues });
            }
            catch (e) {
                figma.ui.postMessage({ type: "AUDIT_RESULT", issues: [], error: String(e) });
            }
        }
        if (msg.type === "PROPOSE_TOKEN") {
            try {
                await proposeToken(msg.payload);
                figma.ui.postMessage({ type: "PROPOSE_OK" });
            }
            catch (e) {
                figma.ui.postMessage({ type: "PROPOSE_ERR", error: String(e) });
            }
        }
        if (msg.type === "FOCUS_NODE") {
            const node = await figma.getNodeByIdAsync(msg.nodeId);
            if (node && "type" in node) {
                const sceneNode = node;
                figma.currentPage.selection = [sceneNode];
                figma.viewport.scrollAndZoomIntoView([sceneNode]);
            }
        }
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
