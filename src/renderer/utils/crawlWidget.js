const DEFAULT_ACTION_DELAY_MS = 300;

export function createChildNode(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    label: '',
    target_anchor: {},
    extract_mode: 'text',
    attribute_name: '',
    children: [],
    ...overrides,
  };
}

export function defaultCrawlActionConfig(overrides = {}) {
  return {
    widget_type: 'normal',
    extract_mode: 'text',
    attribute_name: '',
    label: '',
    children: [],
    parent_container_selector: '',
    sample_dump: [],
    match_count: 0,
    ...overrides,
  };
}

export function buildAnchorFromPick(pickPayload = {}) {
  const anchor = pickPayload.target_anchor || {};
  const selector = pickPayload.parent_container_selector
    || pickPayload.selector_value
    || pickPayload.field_selector
    || anchor.parent_container_selector
    || anchor.selector_value
    || anchor.field_selector
    || '';

  return {
    ...anchor,
    selector_value: selector,
    parent_container_selector: pickPayload.parent_container_selector || anchor.parent_container_selector || pickPayload.selector_value || '',
    field_selector: pickPayload.field_selector || anchor.field_selector || '',
    card_class: pickPayload.card_class || anchor.card_class || '',
    classList: anchor.classList || [],
    xpath: '',
  };
}

export function createCrawlWidgetFromPick(pickPayload = {}) {
  const anchor = buildAnchorFromPick(pickPayload);
  const parentSelector = anchor.parent_container_selector || anchor.selector_value || '';
  const label = anchor.innerText?.slice(0, 48)
    || pickPayload.card_class
    || parentSelector.slice(0, 48)
    || 'Crawl card';

  const actionConfig = defaultCrawlActionConfig({
    label,
    widget_type: pickPayload.widget_type || (pickPayload.sample_dump?.length ? 'parent' : 'normal'),
    parent_container_selector: parentSelector,
    sample_dump: Array.isArray(pickPayload.sample_dump) ? pickPayload.sample_dump : [],
    match_count: Number(pickPayload.match_count) || 0,
  });

  return {
    id: crypto.randomUUID(),
    action_type: 'crawl',
    delay_ms: DEFAULT_ACTION_DELAY_MS,
    target_anchor: {
      ...anchor,
      action_config: actionConfig,
    },
    action_config: actionConfig,
  };
}

export function getCrawlActionConfig(step) {
  const anchor = step?.target_anchor || {};
  const config = step?.action_config || anchor.action_config || {};
  return {
    ...defaultCrawlActionConfig(),
    ...config,
    children: Array.isArray(config.children) ? config.children : [],
  };
}

export function normalizeCrawlStep(step) {
  if (!step) return step;
  const config = getCrawlActionConfig(step);
  const parentSelector = config.parent_container_selector
    || step.target_anchor?.parent_container_selector
    || step.target_anchor?.selector_value
    || '';
  const anchor = {
    ...(step.target_anchor || {}),
    action_config: config,
    parent_container_selector: parentSelector,
    selector_value: step.target_anchor?.selector_value || parentSelector,
  };
  return {
    ...step,
    action_type: 'crawl',
    action_config: {
      ...config,
      parent_container_selector: config.parent_container_selector || parentSelector,
    },
    target_anchor: anchor,
  };
}

export function normalizeCrawlSteps(steps = []) {
  return steps.map((step) => (
    step.action_type === 'crawl' ? normalizeCrawlStep(step) : step
  ));
}

export function isCrawlStep(step) {
  return step?.action_type === 'crawl';
}

export function getCrawlSteps(steps = []) {
  return steps.filter(isCrawlStep);
}

export function updateCrawlStepConfig(step, patch) {
  const config = {
    ...getCrawlActionConfig(step),
    ...patch,
  };
  return normalizeCrawlStep({
    ...step,
    action_config: config,
    target_anchor: {
      ...(step.target_anchor || {}),
      action_config: config,
    },
  });
}

export function applyPickToSteps(steps, pickPayload, context = {}) {
  const { pickKind = 'root', error } = pickPayload;
  if (error) {
    return { steps, error, changed: false };
  }

  if (pickKind === 'root') {
    const widget = createCrawlWidgetFromPick(pickPayload);
    return {
      steps: [...steps, widget],
      widgetId: widget.id,
      changed: true,
    };
  }

  const widgetId = context.selectedWidgetId;
  if (!widgetId) {
    return { steps, error: 'pickNeedsWidget', changed: false };
  }

  const widgetIndex = steps.findIndex((step) => step.id === widgetId);
  if (widgetIndex < 0) {
    return { steps, error: 'pickNeedsWidget', changed: false };
  }

  const widget = normalizeCrawlStep(steps[widgetIndex]);
  const config = getCrawlActionConfig(widget);

  if (pickKind === 'child') {
    const child = createChildNode({
      label: pickPayload.target_anchor?.innerText?.slice(0, 48)
        || pickPayload.target_anchor?.tagName
        || 'Child field',
      target_anchor: buildAnchorFromPick(pickPayload),
    });
    const next = updateCrawlStepConfig(widget, {
      children: [...config.children, child],
    });
    const nextSteps = [...steps];
    nextSteps[widgetIndex] = next;
    return {
      steps: nextSteps,
      widgetId,
      childId: child.id,
      changed: true,
    };
  }

  if (pickKind === 'subchild') {
    const childId = context.selectedChildId;
    if (!childId) {
      return { steps, error: 'pickNeedsChild', changed: false };
    }

    const childIndex = config.children.findIndex((item) => item.id === childId);
    if (childIndex < 0) {
      return { steps, error: 'pickNeedsChild', changed: false };
    }

    const subChild = createChildNode({
      label: pickPayload.target_anchor?.innerText?.slice(0, 48)
        || pickPayload.target_anchor?.tagName
        || 'Sub field',
      target_anchor: buildAnchorFromPick(pickPayload),
    });

    const children = config.children.map((child, index) => {
      if (index !== childIndex) return child;
      return {
        ...child,
        children: [...(child.children || []), subChild],
      };
    });

    const next = updateCrawlStepConfig(widget, { children });
    const nextSteps = [...steps];
    nextSteps[widgetIndex] = next;
    return {
      steps: nextSteps,
      widgetId,
      childId,
      subChildId: subChild.id,
      changed: true,
    };
  }

  return { steps, changed: false };
}

export function getChildAnchorForPickContext(steps, widgetId, childId) {
  const widget = steps.find((step) => step.id === widgetId);
  if (!widget) return null;
  const config = getCrawlActionConfig(widget);
  const child = config.children.find((item) => item.id === childId);
  return child?.target_anchor || null;
}

export function getSelectionHighlightAnchor(steps, widgetId, childId = null, subChildId = null) {
  if (!widgetId) return null;
  const widget = steps.find((step) => step.id === widgetId);
  if (!widget) return null;

  const config = getCrawlActionConfig(widget);

  if (subChildId && childId) {
    const child = config.children.find((item) => item.id === childId);
    const sub = child?.children?.find((item) => item.id === subChildId);
    return sub?.target_anchor || null;
  }

  if (childId) {
    const child = config.children.find((item) => item.id === childId);
    return child?.target_anchor || null;
  }

  return widget.target_anchor || null;
}

export function patchStepAnchor(step, anchorPatch = {}) {
  if (!step) return step;
  return normalizeCrawlStep({
    ...step,
    target_anchor: {
      ...(step.target_anchor || {}),
      ...anchorPatch,
    },
  });
}

export function updateCrawlChildAnchor(steps, widgetId, childId, anchorPatch = {}, subChildId = null) {
  const widgetIndex = steps.findIndex((step) => step.id === widgetId);
  if (widgetIndex < 0) return steps;

  const widget = normalizeCrawlStep(steps[widgetIndex]);
  const config = getCrawlActionConfig(widget);

  if (subChildId) {
    const children = config.children.map((child) => {
      if (child.id !== childId) return child;
      return {
        ...child,
        children: (child.children || []).map((sub) => (
          sub.id === subChildId
            ? { ...sub, target_anchor: { ...(sub.target_anchor || {}), ...anchorPatch } }
            : sub
        )),
      };
    });
    const nextSteps = [...steps];
    nextSteps[widgetIndex] = updateCrawlStepConfig(widget, { children });
    return nextSteps;
  }

  const children = config.children.map((child) => (
    child.id === childId
      ? { ...child, target_anchor: { ...(child.target_anchor || {}), ...anchorPatch } }
      : child
  ));
  const nextSteps = [...steps];
  nextSteps[widgetIndex] = updateCrawlStepConfig(widget, { children });
  return nextSteps;
}

export function applyPromoteToParentToStep(step, promoteResult = {}) {
  if (promoteResult.error) {
    return { step, error: promoteResult.error, changed: false };
  }

  const actionConfig = {
    ...getCrawlActionConfig(step),
    widget_type: 'parent',
    parent_container_selector: promoteResult.parent_container_selector || '',
    sample_dump: Array.isArray(promoteResult.sample_dump) ? promoteResult.sample_dump : [],
    match_count: Number(promoteResult.match_count) || 0,
  };

  const nextStep = normalizeCrawlStep({
    ...step,
    action_config: actionConfig,
    target_anchor: {
      ...(step.target_anchor || {}),
      ...(promoteResult.target_anchor || {}),
      parent_container_selector: promoteResult.parent_container_selector || '',
      selector_value: promoteResult.selector_value || promoteResult.parent_container_selector || '',
      card_class: promoteResult.card_class || step.target_anchor?.card_class || '',
    },
  });

  return { step: nextStep, changed: true };
}

export function describeCrawlSelector(step) {
  const anchor = step?.target_anchor || {};
  const config = getCrawlActionConfig(step);
  return config.parent_container_selector
    || anchor.parent_container_selector
    || anchor.field_selector
    || anchor.selector_value
    || anchor.card_class
    || '—';
}

export function removeCrawlChild(steps, widgetId, childId, subChildId = null) {
  const widgetIndex = steps.findIndex((step) => step.id === widgetId);
  if (widgetIndex < 0) return steps;

  const widget = normalizeCrawlStep(steps[widgetIndex]);
  const config = getCrawlActionConfig(widget);

  if (subChildId) {
    const children = config.children.map((child) => {
      if (child.id !== childId) return child;
      return {
        ...child,
        children: (child.children || []).filter((item) => item.id !== subChildId),
      };
    });
    const nextSteps = [...steps];
    nextSteps[widgetIndex] = updateCrawlStepConfig(widget, { children });
    return nextSteps;
  }

  const children = config.children.filter((child) => child.id !== childId);
  const nextSteps = [...steps];
  nextSteps[widgetIndex] = updateCrawlStepConfig(widget, { children });
  return nextSteps;
}

export function updateCrawlChildField(steps, widgetId, childId, patch, subChildId = null) {
  const widgetIndex = steps.findIndex((step) => step.id === widgetId);
  if (widgetIndex < 0) return steps;

  const widget = normalizeCrawlStep(steps[widgetIndex]);
  const config = getCrawlActionConfig(widget);

  if (subChildId) {
    const children = config.children.map((child) => {
      if (child.id !== childId) return child;
      return {
        ...child,
        children: (child.children || []).map((sub) => (
          sub.id === subChildId ? { ...sub, ...patch } : sub
        )),
      };
    });
    const nextSteps = [...steps];
    nextSteps[widgetIndex] = updateCrawlStepConfig(widget, { children });
    return nextSteps;
  }

  const children = config.children.map((child) => (
    child.id === childId ? { ...child, ...patch } : child
  ));
  const nextSteps = [...steps];
  nextSteps[widgetIndex] = updateCrawlStepConfig(widget, { children });
  return nextSteps;
}
