(() => {
  const STORAGE_KEY = 'supermarket_ie_supervalu_bridge_v1';
  const HASH_PREFIX = '#supermarket-ie-cart=';
  const PANEL_ID = 'supermarket-ie-supervalu-bridge';

  function decodeBase64Url(value) {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    return decodeURIComponent(
      Array.from(atob(padded))
        .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join(''),
    );
  }

  function loadPayloadFromHash() {
    if (!window.location.hash.startsWith(HASH_PREFIX)) return null;
    try {
      const encoded = window.location.hash.slice(HASH_PREFIX.length);
      const payload = JSON.parse(decodeBase64Url(encoded));
      if (payload?.version !== 1 || payload?.retailer !== 'supervalu' || !Array.isArray(payload.items)) return null;
      if (!payload.items.length || payload.items.some((item) => !item?.sku || item.quantity !== 1 || !item.productUrl)) return null;
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ payload, index: 0, completed: [] }));
      history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      return { payload, index: 0, completed: [] };
    } catch {
      return null;
    }
  }

  function loadState() {
    const fromHash = loadPayloadFromHash();
    if (fromHash) return fromHash;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveState(state) {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function clearState() {
    sessionStorage.removeItem(STORAGE_KEY);
    document.getElementById(PANEL_ID)?.remove();
  }

  function safeProductUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'shop.supervalu.ie' && /\/rsid\/\d+\/product\//.test(url.pathname)
        ? url
        : null;
    } catch {
      return null;
    }
  }

  function nativeAddButton(sku) {
    return document.querySelector(`button[data-testid="addToCart_${CSS.escape(sku)}-button-testId"]`);
  }

  function createPanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    panel = document.createElement('aside');
    panel.id = PANEL_ID;
    panel.style.cssText = [
      'position:fixed',
      'right:16px',
      'bottom:16px',
      'z-index:2147483647',
      'width:min(360px,calc(100vw - 32px))',
      'background:#fff',
      'color:#151515',
      'border:1px solid rgba(0,0,0,.16)',
      'border-radius:16px',
      'box-shadow:0 12px 36px rgba(0,0,0,.22)',
      'font:14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'padding:16px',
    ].join(';');
    document.documentElement.appendChild(panel);
    return panel;
  }

  function button(label, onClick, secondary = false) {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = label;
    el.style.cssText = [
      'border:0',
      'border-radius:999px',
      'padding:10px 14px',
      'font:600 14px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'cursor:pointer',
      secondary ? 'background:#f1f1f1;color:#222' : 'background:#111;color:#fff',
    ].join(';');
    el.addEventListener('click', onClick);
    return el;
  }

  function render(state, message = '') {
    const panel = createPanel();
    const item = state.payload.items[state.index];
    const total = state.payload.items.length;

    panel.replaceChildren();

    const title = document.createElement('strong');
    title.textContent = 'Supermarket.ie basket handoff';
    title.style.cssText = 'display:block;font-size:16px;margin-bottom:6px';
    panel.appendChild(title);

    if (!item) {
      const done = document.createElement('p');
      done.textContent = `Finished. ${state.completed.length} of ${total} items were handed to SuperValu. Review your trolley before checkout.`;
      done.style.cssText = 'margin:0 0 12px';
      panel.appendChild(done);

      const cartLink = button('Review SuperValu trolley', () => {
        const current = new URL(window.location.href);
        const rsid = current.pathname.match(/\/rsid\/(\d+)/)?.[1];
        window.location.href = rsid ? `/sm/delivery/rsid/${rsid}/cart-review` : '/cart-review';
      });
      const close = button('Close', clearState, true);
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
      actions.append(cartLink, close);
      panel.appendChild(actions);
      return;
    }

    const progress = document.createElement('p');
    progress.textContent = `Item ${state.index + 1} of ${total}: ${item.name || item.sku}`;
    progress.style.cssText = 'margin:0 0 4px';
    panel.appendChild(progress);

    const note = document.createElement('p');
    note.textContent = message || 'You stay on SuperValu and use your own SuperValu login. Supermarket.ie never receives your password or payment details.';
    note.style.cssText = 'margin:0 0 12px;color:#4b4b4b';
    panel.appendChild(note);

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';

    actions.appendChild(
      button('Add this item', async () => {
        const add = nativeAddButton(item.sku);
        if (!add) {
          render(state, 'The SuperValu Add to Trolley button is not available yet. If SuperValu is asking you to sign in or choose a store, complete that step and try again.');
          return;
        }

        add.click();
        render(state, 'SuperValu is processing the item. If a sign-in window appears, sign in directly with SuperValu, then press Add this item again.');

        const started = Date.now();
        const timer = window.setInterval(() => {
          const stillAddable = nativeAddButton(item.sku);
          if (!stillAddable) {
            window.clearInterval(timer);
            const next = {
              ...state,
              index: state.index + 1,
              completed: [...state.completed, item.sku],
            };
            saveState(next);
            const nextItem = next.payload.items[next.index];
            if (nextItem) {
              const nextUrl = safeProductUrl(nextItem.productUrl);
              if (!nextUrl) {
                render(next, 'The next product URL was rejected by the bridge safety check.');
                return;
              }
              window.location.href = nextUrl.toString();
            } else {
              render(next);
            }
          } else if (Date.now() - started > 8000) {
            window.clearInterval(timer);
            render(state, 'The item has not been confirmed as added. Sign in to SuperValu if prompted, confirm the correct store, then try again.');
          }
        }, 400);
      }),
    );

    actions.appendChild(
      button('Skip item', () => {
        const next = { ...state, index: state.index + 1 };
        saveState(next);
        const nextItem = next.payload.items[next.index];
        if (!nextItem) {
          render(next);
          return;
        }
        const nextUrl = safeProductUrl(nextItem.productUrl);
        if (nextUrl) window.location.href = nextUrl.toString();
      }, true),
    );

    actions.appendChild(button('Cancel handoff', clearState, true));
    panel.appendChild(actions);
  }

  const state = loadState();
  if (!state?.payload?.items?.length) return;

  const item = state.payload.items[state.index];
  if (item) {
    const expected = safeProductUrl(item.productUrl);
    if (expected && window.location.pathname !== expected.pathname) {
      window.location.href = expected.toString();
      return;
    }
  }

  render(state);
})();
