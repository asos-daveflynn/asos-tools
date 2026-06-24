// ─── Types ───────────────────────────────────────────────────────────────────
interface Settings {
  pat: string;
  owner: string;
  repo: string;
  branch: string;
}

interface FilePush {
  path: string;
  content: string;
  message: string;
}

interface AuditIssue {
  nodeId: string;
  nodeName: string;
  property: string;
  severity: "error" | "warning";
  raw: string;
  suggested: string;
}

interface ProposePayload {
  collectionName: string;
  proposedName: string;
  aliasTo: string;
  rationale: string;
  submittedBy: string;
}

// ─── Base64 (UTF-8 safe) ─────────────────────────────────────────────────────
function toBase64(str: string): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 128) {
      bytes.push(c);
    } else if (c < 2048) {
      bytes.push(192 | (c >> 6));
      bytes.push(128 | (c & 63));
    } else {
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
async function githubPut(settings: Settings, file: FilePush) {
  const url = "https://api.github.com/repos/" + settings.owner + "/" + settings.repo + "/contents/" + file.path;
  const headers: Record<string, string> = {
    "Authorization": "Bearer " + settings.pat,
    "Content-Type": "application/json",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  let sha: string | undefined;
  const getRes = await fetch(url, { method: "GET", headers });
  if (getRes.ok) {
    sha = ((await getRes.json()) as { sha: string }).sha;
  }
  const body: Record<string, string> = { message: file.message, content: toBase64(file.content), branch: settings.branch };
  if (sha) body.sha = sha;
  const putRes = await fetch(url, { method: "PUT", headers, body: JSON.stringify(body) });
  if (!putRes.ok) {
    throw new Error("GitHub " + putRes.status + " on " + file.path + ": " + (await putRes.text()));
  }
}

// ─── Node traversal ───────────────────────────────────────────────────────────
function findAllComponentSets(node: BaseNode): ComponentSetNode[] {
  const results: ComponentSetNode[] = [];
  if (node.type === "COMPONENT_SET") {
    results.push(node as ComponentSetNode);
  }
  if ("children" in node) {
    for (const child of (node as ChildrenMixin).children) {
      results.push(...findAllComponentSets(child));
    }
  }
  return results;
}

// ─── Layout helper ────────────────────────────────────────────────────────────
function getLayout(node: ComponentSetNode) {
  const n = node as unknown as Record<string, unknown>;
  return {
    layoutMode: n.layoutMode ?? "NONE",
    primaryAxisAlignItems: n.primaryAxisAlignItems ?? "MIN",
    counterAxisAlignItems: n.counterAxisAlignItems ?? "MIN",
    itemSpacing: n.itemSpacing ?? 0,
    paddingTop: n.paddingTop ?? 0,
    paddingRight: n.paddingRight ?? 0,
    paddingBottom: n.paddingBottom ?? 0,
    paddingLeft: n.paddingLeft ?? 0,
    cornerRadius: n.cornerRadius ?? 0
  };
}

// ─── Component serialiser ─────────────────────────────────────────────────────
function serialiseComponentSet(node: ComponentSetNode) {
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
    componentPropertyDefinitions: node.componentPropertyDefinitions ?? {},
    variantProperties: {},
    variantGroupProperties: node.variantGroupProperties ?? {}
  };
}

// ─── Export SVG for a single node ─────────────────────────────────────────────
async function exportSvgFromNode(node: SceneNode): Promise<string> {
  try {
    const bytes = await node.exportAsync({ format: "SVG_STRING" });
    if (typeof bytes === "string") return bytes;
    return String.fromCharCode(...Array.from(bytes as Uint8Array));
  } catch {
    return "";
  }
}

// ─── Export SVG thumbnail for component set (uses first child) ────────────────
async function exportSvg(node: ComponentSetNode): Promise<string> {
  if (!node.children || node.children.length === 0) return "";
  return exportSvgFromNode(node.children[0] as SceneNode);
}

// ─── Export variables ─────────────────────────────────────────────────────────
async function exportVariables() {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const allVars = await figma.variables.getLocalVariablesAsync();
  const out: { collections: object[]; modes: object[]; variables: object[] } = { collections: [], modes: [], variables: [] };
  for (const col of collections) {
    out.collections.push({ id: col.id, name: col.name });
    for (const mode of col.modes) {
      out.modes.push({ id: mode.modeId, name: mode.name, collectionId: col.id });
    }
    for (const v of allVars) {
      if (v.variableCollectionId !== col.id) continue;
      out.variables.push({ id: v.id, name: v.name, type: v.resolvedType, values: v.valuesByMode, description: v.description || "" });
    }
  }
  return out;
}

// ─── Export text styles ───────────────────────────────────────────────────────
async function exportTextStyles() {
  const styles = await figma.getLocalTextStylesAsync();
  return styles.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description || "",
    type: "TEXT",
    category: "typography",
    fontFamily: (typeof s.fontName === "object" && "family" in s.fontName) ? s.fontName.family : "",
    fontStyle: (typeof s.fontName === "object" && "style" in s.fontName) ? s.fontName.style : "",
    fontSize: s.fontSize ?? null,
    lineHeight: (typeof s.lineHeight === "object" && "unit" in s.lineHeight && s.lineHeight.unit !== "AUTO" && "value" in s.lineHeight) ? (s.lineHeight as { value: number }).value : null,
    letterSpacing: (typeof s.letterSpacing === "object" && "value" in s.letterSpacing) ? (s.letterSpacing as { value: number }).value : null,
    usage: s.description || "",
    contexts: [],
    allowed_components: []
  }));
}

// ─── Build all file payloads ──────────────────────────────────────────────────
async function buildAllPayloads(settings: Settings, syncVersion: number, onProgress: (msg: string) => void): Promise<FilePush[]> {
  const tag = " [sync #" + syncVersion + "]";
  const now = new Date().toISOString();
  const files: FilePush[] = [];

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

  // ── component-render-specs.json (with per-variant SVG thumbnails)
  onProgress("Exporting component SVG thumbnails…");
  const renderSpecComponents = [];
  for (let i = 0; i < componentSets.length; i++) {
    const node = componentSets[i];
    onProgress("SVG " + (i + 1) + "/" + componentSets.length + ": " + node.name + "…");

    // Component-level thumbnail (canonical/first variant)
    const svgThumbnail = await exportSvg(node);

    // Per-variant SVG thumbnails
    const variantNodes = (node.children ?? []).filter(
      (c): c is ComponentNode => c.type === "COMPONENT"
    );
    const variants = [];
    for (let j = 0; j < variantNodes.length; j++) {
      const variantNode = variantNodes[j];
      onProgress(
        "SVG " + (i + 1) + "/" + componentSets.length +
        " · variant " + (j + 1) + "/" + variantNodes.length +
        ": " + variantNode.name + "…"
      );
      const variantSvg = await exportSvgFromNode(variantNode);
      variants.push({
        id: variantNode.id,
        key: variantNode.key,
        name: variantNode.name,
        variantProperties: variantNode.variantProperties ?? {},
        svgThumbnail: variantSvg
      });
    }

    renderSpecComponents.push({
      id: node.id,
      key: node.key,
      name: node.name,
      description: node.description || "",
      componentPropertyDefinitions: node.componentPropertyDefinitions ?? {},
      variantGroupProperties: node.variantGroupProperties ?? {},
      canonicalVariantId: variantNodes[0]?.id ?? node.id,
      canonicalVariantName: variantNodes[0]?.name ?? "",
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
  const groupMap: Record<string, { id: string; key: string; name: string; type: string; description: string; svgString: string }[]> = {};
  for (let i = 0; i < iconSets.length; i++) {
    const node = iconSets[i];
    const groupId = node.name.split("/")[0].toLowerCase().replace(/s+/g, "-");
    onProgress("Icon SVG " + (i + 1) + "/" + iconSets.length + ": " + node.name + "…");
    const svgString = await exportSvg(node);
    if (!groupMap[groupId]) groupMap[groupId] = [];
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

// ─── Token Audit ──────────────────────────────────────────────────────────────
function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.round(n * 255).toString(16).padStart(2, "0");
  return "#" + toHex(r) + toHex(g) + toHex(b);
}

function auditNode(node: SceneNode, allVarNames: Set<string>): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const n = node as unknown as Record<string, unknown>;
  const bound = (n.boundVariables as Record<string, unknown> | undefined) ?? {};

  if (Array.isArray(n.fills)) {
    for (let i = 0; i < (n.fills as unknown[]).length; i++) {
      const fill = (n.fills as Record<string, unknown>[])[i];
      if (fill.type === "SOLID") {
        const fillsBound = (bound.fills as unknown[] | undefined) ?? [];
        const isBound = Array.isArray(fillsBound) && fillsBound[i] != null;
        if (!isBound) {
          const c = fill.color as { r: number; g: number; b: number } | undefined;
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

  if (Array.isArray(n.strokes) && (n.strokes as unknown[]).length > 0) {
    const strokesBound = (bound.strokes as unknown[] | undefined) ?? [];
    const isBound = Array.isArray(strokesBound) && strokesBound[0] != null;
    if (!isBound) {
      const stroke = (n.strokes as Record<string, unknown>[])[0];
      if (stroke.type === "SOLID") {
        const c = stroke.color as { r: number; g: number; b: number } | undefined;
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
    if (typeof n[prop] === "number" && (n[prop] as number) > 0) {
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
    const textNode = node as TextNode;
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

function walkAndAudit(node: SceneNode, allVarNames: Set<string>, results: AuditIssue[]) {
  results.push(...auditNode(node, allVarNames));
  if ("children" in node) {
    for (const child of (node as ChildrenMixin).children) {
      walkAndAudit(child as SceneNode, allVarNames, results);
    }
  }
}

async function runAudit(): Promise<AuditIssue[]> {
  const selection = figma.currentPage.selection;
  if (selection.length === 0) {
    throw new Error("Select a frame or component to audit.");
  }
  const allVars = await figma.variables.getLocalVariablesAsync();
  const allVarNames = new Set<string>(allVars.map(v => v.name));
  const issues: AuditIssue[] = [];
  for (const node of selection) {
    walkAndAudit(node, allVarNames, issues);
  }
  return issues;
}

// ─── Token Propose ────────────────────────────────────────────────────────────
function validateTokenName(name: string): string | null {
  if (!/^[a-z][a-z0-9]*(?:\/[a-z][a-z0-9-]*){1,}$/.test(name)) {
    return "Name must be lowercase slug/slash format, e.g. surface/decision/warning-subtle";
  }
  return null;
}

async function proposeToken(payload: ProposePayload): Promise<void> {
  const nameError = validateTokenName(payload.proposedName);
  if (nameError) throw new Error(nameError);

  const allVars = await figma.variables.getLocalVariablesAsync();
  const existing = allVars.find(v => v.name === payload.proposedName);
  if (existing) {
    throw new Error("Token '" + payload.proposedName + "' already exists (ID: " + existing.id + ").");
  }

  if (payload.aliasTo) {
    const aliasTarget = allVars.find(v => v.name === payload.aliasTo);
    if (!aliasTarget) {
      throw new Error("Alias target '" + payload.aliasTo + "' not found in current variables.");
    }
  }

  const settings = await figma.clientStorage.getAsync("settings") as Settings | undefined;
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
const TOKEN_PRESETS: Record<string, Record<string, string>> = {
  "decision-surface": {
    success:     "surface/decision/success",
    warning:     "surface/decision/warning",
    error:       "surface/decision/error",
    information: "surface/decision/information",
    neutral:     "surface/decision/neutral"
  },
  "action-surface": {
    primary:   "surface/action/primary",
    secondary: "surface/action/secondary",
    accent:    "surface/action/accent-primary",
    disabled:  "surface/action/disabled"
  },
  "base-surface": {
    default:  "surface/base/default",
    subtle:   "surface/base/subtle",
    inverted: "surface/base/inverted"
  }
};

function parseVariantProp(raw: string): { propName: string; values: string[] } | null {
  const colonIdx = raw.indexOf(":");
  if (colonIdx === -1) return null;
  const propName = raw.slice(0, colonIdx).trim();
  const values = raw.slice(colonIdx + 1).split(",").map(v => v.trim()).filter(Boolean);
  return { propName, values };
}

async function scaffoldComponent(
  componentName: string,
  baseType: string,
  variantPropsRaw: string[],
  tokenPreset: string
): Promise<{ nodeId: string; name: string }> {

  if (!componentName || !componentName.trim()) {
    throw new Error("Component name is required.");
  }

  const normName = componentName.trim().toLowerCase().replace(/\s+/g, "-");
  const parsedProps = variantPropsRaw
    .map(parseVariantProp)
    .filter((p): p is { propName: string; values: string[] } => p !== null);

  if (parsedProps.length === 0) {
    throw new Error("At least one variant property is required (e.g. 'Type: success, warning').");
  }

  const presetTokens = TOKEN_PRESETS[tokenPreset] ?? {};
  const allVars = await figma.variables.getLocalVariablesAsync();
  const varByName: Record<string, Variable> = {};
  for (const v of allVars) varByName[v.name] = v;

  const isHorizontal = baseType.includes("horizontal");
  const layoutMode: "HORIZONTAL" | "VERTICAL" = isHorizontal ? "HORIZONTAL" : "VERTICAL";

  function cartesian(arrays: string[][]): string[][] {
    return arrays.reduce<string[][]>(
      (acc, curr) => ([] as string[][]).concat(...acc.map(a => curr.map(b => [...a, b]))),
      [[]]
    );
  }
  const propValueArrays = parsedProps.map(p => p.values);
  const combinations = cartesian(propValueArrays);
  const components: ComponentNode[] = [];

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
      const solidPaint: SolidPaint = { type: "SOLID", color: { r: 0.95, g: 0.95, b: 0.95 } };
      comp.fills = [solidPaint];
      try {
        figma.variables.setBoundVariableForPaint(
          comp.fills[0] as SolidPaint,
          "color",
          token
        );
      } catch {
        const boundFill = figma.variables.setBoundVariableForPaint(
          { type: "SOLID", color: { r: 0.95, g: 0.95, b: 0.95 } } as SolidPaint,
          "color",
          token
        );
        comp.fills = [boundFill];
      }
    } else {
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
  const saved = await figma.clientStorage.getAsync("settings") as Settings | undefined;
  figma.showUI(__html__, { width: 360, height: 480 });
  figma.ui.postMessage({ type: "SETTINGS_LOADED", settings: saved ?? null });

  figma.ui.onmessage = async (msg) => {

    if (msg.type === "SAVE_SETTINGS") {
      await figma.clientStorage.setAsync("settings", msg.settings);
      figma.ui.postMessage({ type: "SETTINGS_SAVED" });
    }

    if (msg.type === "SYNC") {
      const settings = await figma.clientStorage.getAsync("settings") as Settings | undefined;
      if (!settings || !settings.pat) {
        figma.ui.postMessage({ type: "SYNC_ERR", error: "No PAT saved — open Settings first." });
        return;
      }
      try {
        const prevVersion = (await figma.clientStorage.getAsync("syncVersion") as number | undefined) ?? 0;
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
      } catch (e) {
        figma.ui.postMessage({ type: "SYNC_ERR", error: String(e) });
      }
    }

    if (msg.type === "AUDIT_SELECTION") {
      try {
        const issues = await runAudit();
        figma.ui.postMessage({ type: "AUDIT_RESULT", issues });
      } catch (e) {
        figma.ui.postMessage({ type: "AUDIT_RESULT", issues: [], error: String(e) });
      }
    }

    if (msg.type === "PROPOSE_TOKEN") {
      try {
        await proposeToken(msg.payload as ProposePayload);
        figma.ui.postMessage({ type: "PROPOSE_OK" });
      } catch (e) {
        figma.ui.postMessage({ type: "PROPOSE_ERR", error: String(e) });
      }
    }

    if (msg.type === "SCAFFOLD_COMPONENT") {
      try {
        const result = await scaffoldComponent(
          msg.componentName,
          msg.baseType,
          msg.variantProps,
          msg.tokenPreset
        );
        figma.ui.postMessage({ type: "SCAFFOLD_OK", nodeId: result.nodeId, name: result.name });
      } catch (e) {
        figma.ui.postMessage({ type: "SCAFFOLD_ERR", error: String(e) });
      }
    }

  };
}

main();
