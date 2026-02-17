// sjs.js
let activeEffect = null;
const queue = new Set();
let flushing = false;
const targetMap = new WeakMap();
const proxyMap = new WeakMap();

const slotMap = new WeakMap();

export const setSlots = (target, slots) => {
  slotMap.set(target, slots);
};

export const getSlot = (target, name = "default") => {
  const slots = slotMap.get(target);
  if (!slots) return null;
  return slots[name] || slots["default"] || null;
};

export const renderSlot = (slotFn, parent, scopeId = null) => {
  if (!slotFn) return;

  if (typeof slotFn === "function") {
    const result = slotFn(parent, scopeId);
    return result;
  } else if (slotFn instanceof Node) {
    parent.appendChild(slotFn);
  }
  return null;
};

export const processSlots = (children, componentTarget) => {
  if (!children) return;

  const slots = {};

  const processNode = (node, slotName = "default") => {
    const container = document.createElement("div");
    container.setAttribute("data-slot", slotName);

    if (typeof node === "function") {
      slots[slotName] = (parent, scopeId) => {
        const slotContainer = document.createElement("div");
        if (scopeId) slotContainer.setAttribute(scopeId, "");
        node(slotContainer);
        while (slotContainer.firstChild) {
          parent.appendChild(slotContainer.firstChild);
        }
      };
    } else if (node instanceof Node) {
      slots[slotName] = (parent, scopeId) => {
        const clone = node.cloneNode(true);
        if (scopeId) clone.setAttribute(scopeId, "");
        parent.appendChild(clone);
      };
    } else if (Array.isArray(node)) {
      node.forEach((n) => processNode(n, slotName));
    }
  };

  if (Array.isArray(children)) {
    children.forEach((child) => processNode(child));
  } else {
    processNode(children);
  }

  if (Object.keys(slots).length > 0) {
    setSlots(componentTarget, slots);
  }

  return slots;
};

const flush = () => {
  if (flushing) return;
  flushing = true;
  queueMicrotask(() => {
    queue.forEach((effect) => {
      if (effect.deps?.size > 0) effect();
    });
    queue.clear();
    flushing = false;
  });
};

const schedule = (effect) => {
  queue.add(effect);
  flush();
};

function track(target, prop) {
  if (!activeEffect) return;
  let depsMap = targetMap.get(target);
  if (!depsMap) targetMap.set(target, (depsMap = new Map()));
  let dep = depsMap.get(prop);
  if (!dep) depsMap.set(prop, (dep = new Set()));
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect);
    activeEffect.deps.add(dep);
  }
}

function trigger(target, prop) {
  const depsMap = targetMap.get(target);
  if (!depsMap) return;
  const dep = depsMap.get(prop);
  if (!dep) return;
  [...dep].forEach((effect) => {
    if (effect !== activeEffect) schedule(effect);
  });
}

export const $signals = (obj) => {
  if (typeof obj !== "object" || obj === null) return obj;
  if (obj._isSignal) return obj;
  if (proxyMap.has(obj)) return proxyMap.get(obj);
  const proxy = new Proxy(obj, {
    get(target, prop, receiver) {
      if (prop === "_isSignal") return true;
      const value = Reflect.get(target, prop, receiver);
      track(target, prop);
      return typeof value === "object" && value !== null
        ? $signals(value)
        : value;
    },
    set(target, prop, value, receiver) {
      const oldValue = target[prop];
      if (Object.is(oldValue, value)) return true;
      const result = Reflect.set(target, prop, value, receiver);
      trigger(target, prop);
      if (Array.isArray(target) && prop !== "length") trigger(target, "length");
      return result;
    },
  });
  proxyMap.set(obj, proxy);
  return proxy;
};

export const $signal = (v) => {
  const s = { _v: v };
  const fn = function (nv) {
    if (arguments.length === 0) {
      track(s, "value");
      return s._v;
    }
    if (Object.is(nv, s._v)) return;
    s._v = nv;
    trigger(s, "value");
  };
  fn._isSignal = true;
  return fn;
};

export const $watch = (fn) => {
  let cleanupFn;
  const onCleanup = (cb) => {
    cleanupFn = cb;
  };
  const effect = () => {
    if (cleanupFn) cleanupFn();
    cleanup(effect);
    activeEffect = effect;
    fn(onCleanup);
    activeEffect = null;
  };
  effect.deps = new Set();
  effect();
  return effect;
};

function cleanup(effect) {
  effect.deps?.forEach((dep) => dep.delete(effect));
  effect.deps?.clear();
}

export const $computed = (getter) => {
  let value;
  let dirty = true;
  const computedTarget = {};
  const runner = $watch(() => {
    dirty = true;
    trigger(computedTarget, "value");
  });
  cleanup(runner);
  const fn = function () {
    track(computedTarget, "value");
    if (dirty) {
      activeEffect = runner;
      value = getter();
      activeEffect = null;
      dirty = false;
    }
    return value;
  };
  fn._isSignal = true;
  return fn;
};

export const $reconcile = (parent, anchor, currentNodes, data, cb) => {
  const list = data || [];
  while (currentNodes.length > list.length) {
    currentNodes.pop().remove();
  }
  list.forEach((item, i) => {
    if (!currentNodes[i]) {
      const itemSig = $signal(item);
      const idxSig = $signal(i);
      const newNode = cb(itemSig, idxSig);
      newNode._itemSig = itemSig;
      newNode._idxSig = idxSig;
      parent.insertBefore(newNode, anchor);
      currentNodes[i] = newNode;
    } else {
      currentNodes[i]._itemSig(item);
      currentNodes[i]._idxSig(i);
    }
  });
  return currentNodes;
};

export const $onMount = (fn) => {
  if (!window._mounts) window._mounts = [];
  window._mounts.push(fn);
};

export const createApp = (comp) => ({
  mount(sel, children) {
    window._mounts = [];
    const target = document.querySelector(sel);

    if (children) {
      const slotsObj = processSlotsForComponent(children);
      comp(target, slotsObj);
    } else {
      comp(target);
    }

    if (window._mounts) window._mounts.forEach((f) => f());
  },
});

const processSlotsForComponent = (children) => {
  const slots = {};

  const childArray = Array.isArray(children) ? children : [children];

  childArray.forEach((child, index) => {
    const slotName = child.slotName || "default";

    if (typeof child === "function") {
      slots[slotName] = child;
    } else if (child instanceof Node) {
      slots[slotName] = (parent) => {
        const clone = child.cloneNode(true);
        parent.appendChild(clone);
      };
    }
  });

  return slots;
};

export const $component = (compFn, parentEl, slots = {}, props = {}) => {
  if (!compFn || !parentEl) return;

  compFn(parentEl, slots, props);
};
