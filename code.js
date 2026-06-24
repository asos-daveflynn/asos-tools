"use strict";
(() => {
  var __async = (__this, __arguments, generator) => {
    return new Promise((resolve, reject) => {
      var fulfilled = (value) => {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      };
      var rejected = (value) => {
        try {
          step(generator.throw(value));
        } catch (e) {
          reject(e);
        }
      };
      var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
      step((generator = generator.apply(__this, __arguments)).next());
    });
  };

  // code.ts
  function toBase64(str) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if (c < 128) {
        bytes.push(c);
      } else if (c < 2048) {
        bytes.push(192 | c >> 6);
        bytes.push(128 | c & 63);
      } else {
        bytes.push(224 | c >> 12);
        bytes.push(128 | c >> 6 & 63);
        bytes.push(128 | c & 63);
      }
    }
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i];
      const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
      const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
      out += chars[b0 >> 2];
      out += chars[(b0 & 3) << 4 | b1 >> 4];
      out += i + 1 < bytes.length ? chars[(b1 & 15) << 2 | b2 >> 6] : "=";
      out += i + 2 < bytes.length ? chars[b2 & 63] : "=";
    }
    return out;
  }
  function githubPut(settings, file) {
    return __async(this, null, function* () {
      const url = "https://api.github.com/repos/" + settings.owner + "/" + settings.repo + "/contents/" + file.path;
      const headers = {
        "Authorization": "Bearer " + settings.pat,
        "Content-Type": "application/json",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      };
      let sha;
      const getRes = yield fetch(url, { method: "GET", headers });
      if (getRes.ok) {
        sha = (yield getRes.json()).sha;
      }
      const body = { message: file.message, content: toBase64(file.content), branch: settings.branch };
      if (sha) body.sha = sha;
      const putRes = yield fetch(url, { method: "PUT", headers, body: JSON.stringify(body) });
      if (!putRes.ok) {
        throw new Error("GitHub " + putRes.status + " on " + file.path + ": " + (yield putRes.text()));
      }
    });
  }
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
  function getLayout(node) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i;
    const n = node;
    return {
      layoutMode: (_a = n.layoutMode) != null ? _a : "NONE",
      primaryAxisAlignItems: (_b = n.primaryAxisAlignItems) != null ? _b : "MIN",
      counterAxisAlignItems: (_c = n.counterAxisAlignItems) != null ? _c : "MIN",
      itemSpacing: (_d = n.itemSpacing) != null ? _d : 0,
      paddingTop: (_e = n.paddingTop) != null ? _e : 0,
      paddingRight: (_f = n.paddingRight) != null ? _f : 0,
      paddingBottom: (_g = n.paddingBottom) != null ? _g : 0,
      paddingLeft: (_h = n.paddingLeft) != null ? _h : 0,
      cornerRadius: (_i = n.cornerRadius) != null ? _i : 0
    };
  }
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
      componentPropertyDefinitions: (_a = node.componentPropertyDefinitions) != null ? _a : {},
      variantProperties: {},
      variantGroupProperties: (_b = node.variantGroupProperties) != null ? _b : {}
    };
  }
  function exportSvgFromNode(node) {
    return __async(this, null, function* () {
      try {
        const bytes = yield node.exportAsync({ format: "SVG_STRING" });
        if (typeof bytes === "string") return bytes;
        return String.fromCharCode(...Array.from(bytes));
      } catch (e) {
        return "";
      }
    });
  }
  function exportSvg(node) {
    return __async(this, null, function* () {
      if (!node.children || node.children.length === 0) return "";
      return exportSvgFromNode(node.children[0]);
    });
  }
  function exportVariables() {
    return __async(this, null, function* () {
      const collections = yield figma.variables.getLocalVariableCollectionsAsync();
      const allVars = yield figma.variables.getLocalVariablesAsync();
      const out = { collections: [], modes: [], variables: [] };
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
    });
  }
  function exportTextStyles() {
    return __async(this, null, function* () {
      const styles = yield figma.getLocalTextStylesAsync();
      return styles.map((s) => {
        var _a;
        return {
          id: s.id,
          name: s.name,
          description: s.description || "",
          type: "TEXT",
          category: "typography",
          fontFamily: typeof s.fontName === "object" && "family" in s.fontName ? s.fontName.family : "",
          fontStyle: typeof s.fontName === "object" && "style" in s.fontName ? s.fontName.style : "",
          fontSize: (_a = s.fontSize) != null ? _a : null,
          lineHeight: typeof s.lineHeight === "object" && "unit" in s.lineHeight && s.lineHeight.unit !== "AUTO" && "value" in s.lineHeight ? s.lineHeight.value : null,
          letterSpacing: typeof s.letterSpacing === "object" && "value" in s.letterSpacing ? s.letterSpacing.value : null,
          usage: s.description || "",
          contexts: [],
          allowed_components: []
        };
      });
    });
  }
  function buildAllPayloads(settings, syncVersion, onProgress) {
    return __async(this, null, function* () {
      var _a, _b, _c, _d, _e, _f, _g, _h;
      const tag = " [sync #" + syncVersion + "]";
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const files = [];
      onProgress("Exporting variables\u2026");
      const variables = yield exportVariables();
      files.push({
        path: "packages/tokens/exports/figma-variables.json",
        content: JSON.stringify(variables, null, 2),
        message: "chore: sync figma variables" + tag + tag
      });
      onProgress("Exporting text styles\u2026");
      const textStyles = yield exportTextStyles();
      files.push({
        path: "docs/figma-make/text-styles.json",
        content: JSON.stringify(textStyles, null, 2),
        message: "chore: sync text-styles.json" + tag + tag
      });
      onProgress("Loading all pages\u2026");
      yield figma.loadAllPagesAsync();
      onProgress("Scanning components and icons\u2026");
      const allSets = findAllComponentSets(figma.root);
      const iconSets = allSets.filter((n) => n.name.includes("/"));
      const componentSets = allSets.filter((n) => !n.name.includes("/"));
      onProgress("Building components.json (" + componentSets.length + " components)\u2026");
      const componentsData = componentSets.map(serialiseComponentSet);
      files.push({
        path: "docs/figma-make/components.json",
        content: JSON.stringify(componentsData, null, 2),
        message: "chore: sync components.json" + tag + tag
      });
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
      onProgress("Exporting component SVG thumbnails\u2026");
      const renderSpecComponents = [];
      for (let i = 0; i < componentSets.length; i++) {
        const node = componentSets[i];
        onProgress("SVG " + (i + 1) + "/" + componentSets.length + ": " + node.name + "\u2026");
        const svgThumbnail = yield exportSvg(node);
        const variantNodes = ((_a = node.children) != null ? _a : []).filter(
          (c) => c.type === "COMPONENT"
        );
        const variants = [];
        for (let j = 0; j < variantNodes.length; j++) {
          const variantNode = variantNodes[j];
          onProgress(
            "SVG " + (i + 1) + "/" + componentSets.length + " \xB7 variant " + (j + 1) + "/" + variantNodes.length + ": " + variantNode.name + "\u2026"
          );
          const variantSvg = yield exportSvgFromNode(variantNode);
          variants.push({
            id: variantNode.id,
            key: variantNode.key,
            name: variantNode.name,
            variantProperties: (_b = variantNode.variantProperties) != null ? _b : {},
            svgThumbnail: variantSvg
          });
        }
        renderSpecComponents.push({
          id: node.id,
          key: node.key,
          name: node.name,
          description: node.description || "",
          componentPropertyDefinitions: (_c = node.componentPropertyDefinitions) != null ? _c : {},
          variantGroupProperties: (_d = node.variantGroupProperties) != null ? _d : {},
          canonicalVariantId: (_f = (_e = variantNodes[0]) == null ? void 0 : _e.id) != null ? _f : node.id,
          canonicalVariantName: (_h = (_g = variantNodes[0]) == null ? void 0 : _g.name) != null ? _h : "",
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
      onProgress("Building icons.json (" + iconSets.length + " icon sets)\u2026");
      const iconsData = iconSets.map(serialiseComponentSet);
      files.push({
        path: "docs/figma-make/icons.json",
        content: JSON.stringify(iconsData, null, 2),
        message: "chore: sync icons.json" + tag + tag
      });
      onProgress("Building icon groups\u2026");
      const groupMap = {};
      for (let i = 0; i < iconSets.length; i++) {
        const node = iconSets[i];
        const groupId = node.name.split("/")[0].toLowerCase().replace(/s+/g, "-");
        onProgress("Icon SVG " + (i + 1) + "/" + iconSets.length + ": " + node.name + "\u2026");
        const svgString = yield exportSvg(node);
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
    });
  }
  function rgbToHex(r, g, b) {
    const toHex = (n) => Math.round(n * 255).toString(16).padStart(2, "0");
    return "#" + toHex(r) + toHex(g) + toHex(b);
  }
  function auditNode(node, allVarNames) {
    var _a, _b, _c;
    const issues = [];
    const n = node;
    const bound = (_a = n.boundVariables) != null ? _a : {};
    if (Array.isArray(n.fills)) {
      for (let i = 0; i < n.fills.length; i++) {
        const fill = n.fills[i];
        if (fill.type === "SOLID") {
          const fillsBound = (_b = bound.fills) != null ? _b : [];
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
      const strokesBound = (_c = bound.strokes) != null ? _c : [];
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
    results.push(...auditNode(node, allVarNames));
    if ("children" in node) {
      for (const child of node.children) {
        walkAndAudit(child, allVarNames, results);
      }
    }
  }
  function runAudit() {
    return __async(this, null, function* () {
      const selection = figma.currentPage.selection;
      if (selection.length === 0) {
        throw new Error("Select a frame or component to audit.");
      }
      const allVars = yield figma.variables.getLocalVariablesAsync();
      const allVarNames = new Set(allVars.map((v) => v.name));
      const issues = [];
      for (const node of selection) {
        walkAndAudit(node, allVarNames, issues);
      }
      return issues;
    });
  }
  function validateTokenName(name) {
    if (!/^[a-z][a-z0-9]*(?:\/[a-z][a-z0-9-]*){1,}$/.test(name)) {
      return "Name must be lowercase slug/slash format, e.g. surface/decision/warning-subtle";
    }
    return null;
  }
  function proposeToken(payload) {
    return __async(this, null, function* () {
      const nameError = validateTokenName(payload.proposedName);
      if (nameError) throw new Error(nameError);
      const allVars = yield figma.variables.getLocalVariablesAsync();
      const existing = allVars.find((v) => v.name === payload.proposedName);
      if (existing) {
        throw new Error("Token '" + payload.proposedName + "' already exists (ID: " + existing.id + ").");
      }
      if (payload.aliasTo) {
        const aliasTarget = allVars.find((v) => v.name === payload.aliasTo);
        if (!aliasTarget) {
          throw new Error("Alias target '" + payload.aliasTo + "' not found in current variables.");
        }
      }
      const settings = yield figma.clientStorage.getAsync("settings");
      if (!settings || !settings.pat) {
        throw new Error("No GitHub PAT saved \u2014 open Settings first.");
      }
      const issueTitle = "Token proposal: " + payload.proposedName;
      const issueBody = [
        "## Token proposal",
        "",
        "| Field | Value |",
        "| --- | --- |",
        "| **Proposed name** | `" + payload.proposedName + "` |",
        "| **Collection** | " + payload.collectionName + " |",
        "| **Alias to** | `" + (payload.aliasTo || "\u2014") + "` |",
        "| **Submitted by** | " + payload.submittedBy + " |",
        "| **Figma file** | " + figma.root.name + " |",
        "| **Timestamp** | " + (/* @__PURE__ */ new Date()).toISOString() + " |",
        "",
        "## Rationale",
        "",
        payload.rationale,
        "",
        "---",
        "_Submitted via Thread DS Plugin \u2014 Token Propose_"
      ].join("\n");
      const issueUrl = "https://api.github.com/repos/" + settings.owner + "/" + settings.repo + "/issues";
      const res = yield fetch(issueUrl, {
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
        const errText = yield res.text();
        if (res.status === 422) {
          const retry = yield fetch(issueUrl, {
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
            throw new Error("GitHub " + retry.status + ": " + (yield retry.text()));
          }
          return;
        }
        throw new Error("GitHub " + res.status + ": " + errText);
      }
    });
  }
  var TOKEN_PRESETS = {
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
    if (colonIdx === -1) return null;
    const propName = raw.slice(0, colonIdx).trim();
    const values = raw.slice(colonIdx + 1).split(",").map((v) => v.trim()).filter(Boolean);
    return { propName, values };
  }
  function scaffoldComponent(componentName, baseType, variantPropsRaw, tokenPreset) {
    return __async(this, null, function* () {
      var _a;
      if (!componentName || !componentName.trim()) {
        throw new Error("Component name is required.");
      }
      const normName = componentName.trim().toLowerCase().replace(/\s+/g, "-");
      const parsedProps = variantPropsRaw.map(parseVariantProp).filter((p) => p !== null);
      if (parsedProps.length === 0) {
        throw new Error("At least one variant property is required (e.g. 'Type: success, warning').");
      }
      const presetTokens = (_a = TOKEN_PRESETS[tokenPreset]) != null ? _a : {};
      const allVars = yield figma.variables.getLocalVariablesAsync();
      const varByName = {};
      for (const v of allVars) varByName[v.name] = v;
      const isHorizontal = baseType.includes("horizontal");
      const layoutMode = isHorizontal ? "HORIZONTAL" : "VERTICAL";
      function cartesian(arrays) {
        return arrays.reduce(
          (acc, curr) => [].concat(...acc.map((a) => curr.map((b) => [...a, b]))),
          [[]]
        );
      }
      const propValueArrays = parsedProps.map((p) => p.values);
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
        yield figma.loadFontAsync({ family: "Inter", style: "Regular" });
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
            figma.variables.setBoundVariableForPaint(
              comp.fills[0],
              "color",
              token
            );
          } catch (e) {
            const boundFill = figma.variables.setBoundVariableForPaint(
              { type: "SOLID", color: { r: 0.95, g: 0.95, b: 0.95 } },
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
      set.description = "Proposed component \u2014 Thread DS Sandbox. Created by Thread DS Plugin.\nToken preset: " + tokenPreset;
      set.x = figma.viewport.center.x - set.width / 2;
      set.y = figma.viewport.center.y - set.height / 2;
      figma.currentPage.selection = [set];
      figma.viewport.scrollAndZoomIntoView([set]);
      return { nodeId: set.id, name: set.name };
    });
  }
  function main() {
    return __async(this, null, function* () {
      const saved = yield figma.clientStorage.getAsync("settings");
      figma.showUI(__html__, { width: 360, height: 480 });
      figma.ui.postMessage({ type: "SETTINGS_LOADED", settings: saved != null ? saved : null });
      figma.ui.onmessage = (msg) => __async(null, null, function* () {
        var _a;
        if (msg.type === "SAVE_SETTINGS") {
          yield figma.clientStorage.setAsync("settings", msg.settings);
          figma.ui.postMessage({ type: "SETTINGS_SAVED" });
        }
        if (msg.type === "SYNC") {
          const settings = yield figma.clientStorage.getAsync("settings");
          if (!settings || !settings.pat) {
            figma.ui.postMessage({ type: "SYNC_ERR", error: "No PAT saved \u2014 open Settings first." });
            return;
          }
          try {
            const prevVersion = (_a = yield figma.clientStorage.getAsync("syncVersion")) != null ? _a : 0;
            const syncVersion = prevVersion + 1;
            yield figma.clientStorage.setAsync("syncVersion", syncVersion);
            const files = yield buildAllPayloads(settings, syncVersion, (message) => {
              figma.ui.postMessage({ type: "SYNC_PROGRESS", message });
            });
            const total = files.length;
            for (let i = 0; i < files.length; i++) {
              figma.ui.postMessage({ type: "SYNC_PROGRESS", message: "Pushing " + (i + 1) + "/" + total + ": " + files[i].path.split("/").pop() + "\u2026" });
              yield githubPut(settings, files[i]);
            }
            figma.ui.postMessage({ type: "SYNC_OK", count: total, syncVersion });
          } catch (e) {
            figma.ui.postMessage({ type: "SYNC_ERR", error: String(e) });
          }
        }
        if (msg.type === "AUDIT_SELECTION") {
          try {
            const issues = yield runAudit();
            figma.ui.postMessage({ type: "AUDIT_RESULT", issues });
          } catch (e) {
            figma.ui.postMessage({ type: "AUDIT_RESULT", issues: [], error: String(e) });
          }
        }
        if (msg.type === "PROPOSE_TOKEN") {
          try {
            yield proposeToken(msg.payload);
            figma.ui.postMessage({ type: "PROPOSE_OK" });
          } catch (e) {
            figma.ui.postMessage({ type: "PROPOSE_ERR", error: String(e) });
          }
        }
        if (msg.type === "SCAFFOLD_COMPONENT") {
          try {
            const result = yield scaffoldComponent(
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
      });
    });
  }
  main();
})();
