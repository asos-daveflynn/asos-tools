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

// ─── Export SVG for first child variant ───────────────────────────────────────
async function exportSvg(node: ComponentSetNode): Promise<string> {
  if (!node.children || node.children.length === 0) return "";
  try {
    const bytes = await node.children[0].exportAsync({ format: "SVG_STRING" });
    if (typeof bytes === "string") return bytes;
    return String.fromCharCode(...Array.from(bytes as Uint8Array));
  } catch {
    return "";
  }
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
      componentPropertyDefinitions: node.componentPropertyDefinitions ?? {},
      variantGroupProperties: node.variantGroupProperties ?? {},
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

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const saved = await figma.clientStorage.getAsync("settings") as Settings | undefined;
  figma.showUI(__html__, { width: 340, height: (saved && saved.pat) ? 220 : 340 });
  figma.ui.postMessage({ type: "SETTINGS_LOADED", settings: saved ?? null });

  figma.ui.onmessage = async (msg) => {
    if (msg.type === "SAVE_SETTINGS") {
      await figma.clientStorage.setAsync("settings", msg.settings);
      figma.ui.postMessage({ type: "SETTINGS_SAVED" });
      figma.ui.resize(340, 220);
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
  };
}

main();
