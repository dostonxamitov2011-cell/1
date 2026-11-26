/* ==========================================================================
   VitaHerb Store — script.js
   Product info (name/price/image/description/etc.) lives in index.html as
   data-* attributes on each .product-card. This file only handles behaviour.
   ========================================================================== */

(function () {
  "use strict";

  /* ---------------- Config ---------------- */
  const INITIAL_VISIBLE = 27;
  const LOAD_STEP = 15;
  const SEARCH_DEBOUNCE_MS = 500;

  // Telegram token endi brauzerda EMAS — api.php (server) ichida yashirin turadi.
  const API_URL = "api.php";
  const GOOGLE_CLIENT_ID = "BU_YERGA_CLIENT_ID.apps.googleusercontent.com"; // api.php dagi bilan bir xil
  const SESSION_KEY = "vitaherb_session";
  let sessionToken = null;
  try { sessionToken = window.localStorage.getItem(SESSION_KEY); } catch (e) {}

  function api(action, data) {
    return fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ action: action, token: sessionToken }, data || {})),
    }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* ---------------- State ---------------- */
  let activeCategory = "all";
  let searchTerm = "";
  let visibleCount = INITIAL_VISIBLE;
  let cart = [];      // [{name, price, qty, image}]
  let wishlist = [];  // [{name, price, image}]

  /* ---------------- Helpers ---------------- */
  const money = (n) => n.toLocaleString("uz-UZ").replace(/,/g, " ") + " so'm";

  const allCards = Array.from(document.querySelectorAll(".product-card"));
  const resultCountEl = document.getElementById("resultCount");
  const emptyState = document.getElementById("emptyState");
  const loadMoreBtn = document.getElementById("loadMoreBtn");

  function cardData(card) {
    // Image is read straight from the visible <img> tag (not a separate
    // data attribute) so editing one src in index.html updates everywhere:
    // the card, the cart, the wishlist, and the detail window.
    const imgEl = card.querySelector(".product-img");
    return {
      name: card.dataset.name,
      price: parseInt(card.dataset.price, 10),
      image: imgEl ? imgEl.getAttribute("src") : card.dataset.image,
      category: card.dataset.category,
      categoryLabel: card.dataset.categoryLabel,
      description: card.dataset.description,
      unit: card.dataset.unit,
      delivery: card.dataset.delivery,
    };
  }

  /* ---------------- Body scroll lock (prevents background jumping/scrolling
     while a modal or panel is open — important for mobile) ---------------- */
  const openModals = new Set();
  let savedScrollY = 0;

  function applyBodyScrollLock() {
    const shouldLock = openModals.size > 0;
    const isLocked = document.body.classList.contains("scroll-locked");
    if (shouldLock && !isLocked) {
      savedScrollY = window.scrollY || window.pageYOffset;
      document.body.style.top = "-" + savedScrollY + "px";
      document.body.classList.add("scroll-locked");
    } else if (!shouldLock && isLocked) {
      document.body.classList.remove("scroll-locked");
      document.body.style.top = "";
      window.scrollTo(0, savedScrollY);
    }
  }
  function markModalOpen(name) { openModals.add(name); applyBodyScrollLock(); }
  function markModalClosed(name) { openModals.delete(name); applyBodyScrollLock(); }

  /* ---------------- Category tiles ---------------- */
  function selectCategory(slug) {
    document.querySelectorAll(".cat-tile").forEach((b) => b.classList.toggle("active", b.dataset.cat === slug));
    activeCategory = slug;
    visibleCount = INITIAL_VISIBLE;
    render();
  }

  document.querySelectorAll(".cat-tile").forEach((tile) => {
    tile.addEventListener("click", () => {
      selectCategory(tile.dataset.cat);
      document.getElementById("productsGrid").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  /* ---------------- Fikr-mulohaza (feedback) form ---------------- */
  const feedbackForm = document.getElementById("feedbackForm");
  const feedbackThanks = document.getElementById("feedbackThanks");
  const feedbackStars = document.querySelectorAll(".feedback-star");
  let feedbackRating = 0;

  feedbackStars.forEach((star) => {
    star.addEventListener("click", () => {
      feedbackRating = parseInt(star.dataset.val, 10);
      feedbackStars.forEach((s) => {
        s.classList.toggle("active", parseInt(s.dataset.val, 10) <= feedbackRating);
      });
    });
  });

  if (feedbackForm) {
    feedbackForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const feedbackName = document.getElementById("feedbackName").value.trim();
      const feedbackMessage = document.getElementById("feedbackMessage").value.trim();
      const stars = "★".repeat(feedbackRating) + "☆".repeat(5 - feedbackRating);

      const text =
        "💬 <b>Yangi fikr-mulohaza!</b>\n\n" +
        `👤 Ism: ${escapeHtml(feedbackName)}\n` +
        `⭐ Baho: ${stars} (${feedbackRating}/5)\n\n` +
        `📝 Fikr: ${escapeHtml(feedbackMessage)}`;

      api("feedback", { name: feedbackName, rating: feedbackRating, message: feedbackMessage }).catch(() => {
        // Even if sending fails, the person still sees the thank-you —
        // feedback isn't critical the way an order is.
      });

      feedbackForm.classList.add("hide");
      setTimeout(() => {
        feedbackForm.style.display = "none";
        feedbackThanks.classList.add("show");
      }, 280);
      feedbackForm.reset();
      feedbackRating = 0;
      feedbackStars.forEach((s) => s.classList.remove("active"));
    });
  }

  /* ---------------- Search (debounced 500ms) ---------------- */
  let searchDebounceTimer = null;
  function wireSearch(input) {
    if (!input) return;
    input.addEventListener("input", () => {
      const value = input.value;
      document.querySelectorAll(".search-input").forEach((el) => {
        if (el !== input) el.value = value;
      });
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        searchTerm = value.trim().toLowerCase();
        visibleCount = INITIAL_VISIBLE;
        render();
      }, SEARCH_DEBOUNCE_MS);
    });
  }
  document.querySelectorAll(".search-input").forEach(wireSearch);

  /* ---------------- Filtering + render ---------------- */
  function getFiltered() {
    return allCards.filter((card) => {
      const matchesCat = activeCategory === "all" || card.dataset.category === activeCategory;
      const name = card.dataset.name.toLowerCase();
      const matchesSearch = !searchTerm || name.includes(searchTerm);
      return matchesCat && matchesSearch;
    });
  }

  function render() {
    const filtered = getFiltered();
    allCards.forEach((c) => c.classList.add("is-hidden"));
    filtered.slice(0, visibleCount).forEach((c) => c.classList.remove("is-hidden"));
    resultCountEl.textContent = filtered.length;
    emptyState.classList.toggle("show", filtered.length === 0);
    loadMoreBtn.classList.toggle("is-hidden", filtered.length <= visibleCount);
  }

  loadMoreBtn.addEventListener("click", () => {
    if (loadMoreBtn.classList.contains("is-loading")) return;
    loadMoreBtn.classList.add("is-loading");
    loadMoreBtn.disabled = true;
    const originalText = loadMoreBtn.textContent;
    loadMoreBtn.textContent = "Yuklanmoqda...";

    setTimeout(() => {
      visibleCount += LOAD_STEP;
      render();
      loadMoreBtn.classList.remove("is-loading");
      loadMoreBtn.disabled = false;
      loadMoreBtn.textContent = originalText;
    }, 500);
  });

  /* ======================================================================
     CART
     ====================================================================== */
  const cartBadge = document.getElementById("cartBadge");
  const cartItemsEl = document.getElementById("cartItems");
  const cartEmptyEl = document.getElementById("cartEmpty");
  const cartSubtotalEl = document.getElementById("cartSubtotal");
  const cartTotalEl = document.getElementById("cartTotal");
  const checkoutBtn = document.getElementById("checkoutBtn");

  function findCartItem(name) {
    return cart.find((i) => i.name === name);
  }

  function addToCart(name, price, image, qty) {
    qty = qty || 1;
    const existing = findCartItem(name);
    if (existing) existing.qty += qty;
    else cart.push({ name, price, qty, image });
    updateCartUI();
    pulseBadge(cartBadge);
    showToast(name);
  }

  function changeCartQty(name, delta) {
    const item = findCartItem(name);
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) cart = cart.filter((i) => i.name !== name);
    updateCartUI();
  }

  function cartTotal() {
    return cart.reduce((sum, i) => sum + i.price * i.qty, 0);
  }
  function cartCount() {
    return cart.reduce((sum, i) => sum + i.qty, 0);
  }

  function updateCartUI() {
    cartBadge.textContent = cartCount();
    const cartBadgeMobile = document.getElementById("cartBadgeMobile");
    if (cartBadgeMobile) cartBadgeMobile.textContent = cartCount();
    cartItemsEl.innerHTML = "";
    const isEmpty = cart.length === 0;
    cartEmptyEl.classList.toggle("show", isEmpty);
    checkoutBtn.disabled = isEmpty;

    cart.forEach((item) => {
      const row = document.createElement("div");
      row.className = "cart-item";
      row.innerHTML = `
        <img class="cart-item-img" src="${item.image}" alt="${item.name}">
        <div class="cart-item-info">
          <p class="cart-item-name">${item.name}</p>
          <p class="cart-item-price">${money(item.price)}</p>
          <button class="remove-btn" type="button" data-name="${item.name}">O'chirish</button>
        </div>
        <div class="qty-control">
          <button class="qty-btn" type="button" data-action="dec" data-name="${item.name}">−</button>
          <span class="qty-val">${item.qty}</span>
          <button class="qty-btn" type="button" data-action="inc" data-name="${item.name}">+</button>
        </div>
      `;
      cartItemsEl.appendChild(row);
    });

    cartItemsEl.querySelectorAll('[data-action="inc"]').forEach((b) =>
      b.addEventListener("click", () => changeCartQty(b.dataset.name, 1))
    );
    cartItemsEl.querySelectorAll('[data-action="dec"]').forEach((b) =>
      b.addEventListener("click", () => changeCartQty(b.dataset.name, -1))
    );
    cartItemsEl.querySelectorAll(".remove-btn").forEach((b) =>
      b.addEventListener("click", () => {
        cart = cart.filter((i) => i.name !== b.dataset.name);
        updateCartUI();
      })
    );

    cartSubtotalEl.textContent = money(cartTotal());
    cartTotalEl.textContent = money(cartTotal());
  }

  function pulseBadge(el) {
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");
    const mobileId = el.id === "cartBadge" ? "cartBadgeMobile" : el.id === "wishlistBadge" ? "wishlistBadgeMobile" : null;
    if (mobileId) {
      const mobileEl = document.getElementById(mobileId);
      if (mobileEl) {
        mobileEl.classList.remove("pop");
        void mobileEl.offsetWidth;
        mobileEl.classList.add("pop");
      }
    }
  }

  /* ---------------- Cart panel open/close ---------------- */
  const cartPanel = document.getElementById("cartPanel");
  const cartOverlay = document.getElementById("cartOverlay");
  function openCart() { closeWishlist(); cartPanel.classList.add("open"); cartOverlay.classList.add("show"); markModalOpen("cart"); }
  function closeCart() { cartPanel.classList.remove("open"); cartOverlay.classList.remove("show"); markModalClosed("cart"); }
  document.getElementById("cartBtn").addEventListener("click", openCart);
  document.getElementById("closeCartBtn").addEventListener("click", closeCart);
  cartOverlay.addEventListener("click", closeCart);

  /* ======================================================================
     WISHLIST
     ====================================================================== */
  const wishlistBadge = document.getElementById("wishlistBadge");
  const wishlistItemsEl = document.getElementById("wishlistItems");
  const wishlistEmptyEl = document.getElementById("wishlistEmpty");
  const wishlistOverlay = document.getElementById("wishlistOverlay");

  function isWishlisted(name) {
    return wishlist.some((i) => i.name === name);
  }

  function toggleWishlist(name, price, image) {
    if (isWishlisted(name)) {
      wishlist = wishlist.filter((i) => i.name !== name);
    } else {
      wishlist.push({ name, price, image });
    }
    updateWishlistUI();
    syncLikeButtons();
    pulseBadge(wishlistBadge);
  }

  function updateWishlistUI() {
    wishlistBadge.textContent = wishlist.length;
    const wishlistBadgeMobile = document.getElementById("wishlistBadgeMobile");
    if (wishlistBadgeMobile) wishlistBadgeMobile.textContent = wishlist.length;
    wishlistItemsEl.innerHTML = "";
    const isEmpty = wishlist.length === 0;
    wishlistEmptyEl.classList.toggle("show", isEmpty);

    wishlist.forEach((item, idx) => {
      const card = document.createElement("div");
      card.className = "wishlist-card";
      card.style.animationDelay = (idx * 0.04) + "s";
      card.innerHTML = `
        <div class="wishlist-card-img-wrap">
          <img class="wishlist-card-img" src="${item.image}" alt="${item.name}">
        </div>
        <div class="wishlist-card-body">
          <p class="wishlist-card-name">${item.name}</p>
          <p class="wishlist-card-price">${money(item.price)}</p>
          <div class="wishlist-card-actions">
            <button class="wishlist-card-move" type="button" data-name="${item.name}" data-price="${item.price}" data-image="${item.image}">Savatga</button>
            <button class="wishlist-card-remove" type="button" data-name="${item.name}" aria-label="O'chirish">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
      `;
      wishlistItemsEl.appendChild(card);
    });

    wishlistItemsEl.querySelectorAll(".wishlist-card-remove").forEach((b) =>
      b.addEventListener("click", () => {
        wishlist = wishlist.filter((i) => i.name !== b.dataset.name);
        updateWishlistUI();
        syncLikeButtons();
      })
    );
    wishlistItemsEl.querySelectorAll(".wishlist-card-move").forEach((b) =>
      b.addEventListener("click", () => {
        addToCart(b.dataset.name, parseInt(b.dataset.price, 10), b.dataset.image, 1);
        wishlist = wishlist.filter((i) => i.name !== b.dataset.name);
        updateWishlistUI();
        syncLikeButtons();
      })
    );
  }

  function syncLikeButtons() {
    document.querySelectorAll(".product-card .like-btn").forEach((btn) => {
      const card = btn.closest(".product-card");
      const liked = isWishlisted(card.dataset.name);
      btn.classList.toggle("liked", liked);
    });
    if (currentDetailCard) {
      detailLikeBtn.classList.toggle("liked", isWishlisted(currentDetailCard.dataset.name));
    }
  }

  function openWishlist() { closeCart(); wishlistOverlay.classList.add("show"); markModalOpen("wishlist"); }
  function closeWishlist() { wishlistOverlay.classList.remove("show"); markModalClosed("wishlist"); }
  document.getElementById("wishlistBtn").addEventListener("click", openWishlist);
  document.getElementById("closeWishlistBtn").addEventListener("click", closeWishlist);
  wishlistOverlay.addEventListener("click", (e) => {
    if (e.target === wishlistOverlay) closeWishlist();
  });

  document.querySelectorAll(".product-card .like-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const card = btn.closest(".product-card");
      const d = cardData(card);
      toggleWishlist(d.name, d.price, d.image);
      btn.classList.remove("pop");
      void btn.offsetWidth;
      btn.classList.add("pop");
    });
  });

  /* ======================================================================
     ADD-TO-CART ICON BUTTON (instant tap — adds straight to the cart)
     ====================================================================== */
  document.querySelectorAll(".product-card .add-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (btn.classList.contains("added")) return;
      const card = btn.closest(".product-card");
      const d = cardData(card);
      addToCart(d.name, d.price, d.image, 1);
      btn.classList.add("added");
      setTimeout(() => btn.classList.remove("added"), 700);
    });
  });

  /* ---------------- Toast ---------------- */
  let toastTimer = null;
  function showToast(sub, title) {
    const toast = document.getElementById("toast");
    document.getElementById("toastTitle").textContent = title || "Savatga qo'shildi 🎉";
    document.getElementById("toastSub").textContent = sub;
    toast.style.top = "16px";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.style.top = "-120px"; }, 2200);
  }

  /* ======================================================================
     PRODUCT DETAIL MODAL (opens on card click; data comes from data-* attrs)
     ====================================================================== */
  const detailOverlay = document.getElementById("detailModalOverlay");
  const detailImage = document.getElementById("detailImage");
  const detailCategory = document.getElementById("detailCategory");
  const detailName = document.getElementById("detailName");
  const detailDescription = document.getElementById("detailDescription");
  const detailUnit = document.getElementById("detailUnit");
  const detailDelivery = document.getElementById("detailDelivery");
  const detailPrice = document.getElementById("detailPrice");
  const detailQtyVal = document.getElementById("detailQtyVal");
  const detailLikeBtn = document.getElementById("detailLikeBtn");
  const detailAddBtn = document.getElementById("detailAddBtn");

  let currentDetailCard = null;
  let detailQty = 1;
  let detailUnitPrice = 0;

  function updateDetailPrice() {
    detailPrice.textContent = money(detailUnitPrice * detailQty);
  }

  function openDetail(card) {
    currentDetailCard = card;
    const d = cardData(card);
    detailQty = 1;
    detailUnitPrice = d.price;

    detailImage.src = d.image;
    detailImage.alt = d.name;
    detailCategory.textContent = (d.categoryLabel || "").toUpperCase();
    detailName.textContent = d.name;
    detailDescription.textContent = d.description || "";
    detailUnit.textContent = d.unit ? ("Hajmi: " + d.unit) : "";
    detailDelivery.textContent = d.delivery || "";
    detailQtyVal.textContent = detailQty;
    updateDetailPrice();
    detailLikeBtn.classList.toggle("liked", isWishlisted(d.name));

    detailOverlay.classList.add("show");
    markModalOpen("detail");
  }

  function closeDetail() {
    detailOverlay.classList.remove("show");
    currentDetailCard = null;
    markModalClosed("detail");
  }

  allCards.forEach((card) => {
    card.addEventListener("click", () => openDetail(card));
  });

  document.getElementById("closeDetailBtn").addEventListener("click", closeDetail);
  detailOverlay.addEventListener("click", (e) => {
    if (e.target === detailOverlay) closeDetail();
  });

  document.getElementById("detailQtyPlus").addEventListener("click", () => {
    detailQty += 1;
    detailQtyVal.textContent = detailQty;
    updateDetailPrice();
  });
  document.getElementById("detailQtyMinus").addEventListener("click", () => {
    if (detailQty <= 1) return;
    detailQty -= 1;
    detailQtyVal.textContent = detailQty;
    updateDetailPrice();
  });

  detailLikeBtn.addEventListener("click", () => {
    if (!currentDetailCard) return;
    const d = cardData(currentDetailCard);
    toggleWishlist(d.name, d.price, d.image);
  });

  detailAddBtn.addEventListener("click", () => {
    if (!currentDetailCard) return;
    const d = cardData(currentDetailCard);
    addToCart(d.name, d.price, d.image, detailQty);
    closeDetail();
  });

  /* ======================================================================
     GOOGLE LOGIN (haqiqiy Google Identity Services) + SESSION
     ====================================================================== */
  let currentUser = null; // { name, email, picture, phone, addresses[], orders[] }
  let pendingCheckout = false;
  const loginOverlay = document.getElementById("loginModalOverlay");
  const loginError = document.getElementById("loginError");

  function setSession(token) {
    sessionToken = token;
    try {
      if (token) window.localStorage.setItem(SESSION_KEY, token);
      else window.localStorage.removeItem(SESSION_KEY);
    } catch (e) {}
  }
  function setUser(u) {
    currentUser = u;
    const t = document.querySelector(".login-btn-text");
    if (t) t.textContent = u ? ((u.name || "").split(" ")[0] || "Profil") : "Kirish";
  }
  function openLogin(msg) {
    loginError.textContent = "";
    if (msg) document.getElementById("loginSub").textContent = msg;
    loginOverlay.classList.add("show");
    markModalOpen("login");
    initGoogle();
  }
  function closeLoginModal() {
    loginOverlay.classList.remove("show");
    markModalClosed("login");
    pendingCheckout = false;
  }

  let googleReady = false;
  function initGoogle() {
    const box = document.getElementById("googleBtnBox");
    if (googleReady) return;
    if (GOOGLE_CLIENT_ID.indexOf("BU_YERGA") === 0) {
      loginError.textContent = "Google Client ID hali kiritilmagan (script.js va api.php).";
      return;
    }
    if (!window.google || !google.accounts) {
      loginError.textContent = "Google yuklanmoqda... bir soniyadan keyin qayta oching.";
      return;
    }
    google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onGoogleCredential });
    google.accounts.id.renderButton(box, { theme: "outline", size: "large", width: 280, locale: "uz" });
    googleReady = true;
  }
  window.addEventListener("load", () => setTimeout(() => { if (loginOverlay.classList.contains("show")) initGoogle(); }, 300));

  function onGoogleCredential(resp) {
    loginError.textContent = "Tekshirilmoqda...";
    api("login", { credential: resp.credential }).then((r) => {
      if (!r.ok) { loginError.textContent = "Kirib bo'lmadi: " + (r.error || "xatolik"); return; }
      setSession(r.token);
      setUser(r.user);
      const goCheckout = pendingCheckout;
      closeLoginModal();
      showToast(r.user.email, "Xush kelibsiz, " + (r.user.name || "") + "! 👋");
      if (goCheckout) openCheckout();
    });
  }

  document.getElementById("loginBtn").addEventListener("click", () => (currentUser ? openProfile() : openLogin()));
  document.getElementById("closeLoginBtn").addEventListener("click", closeLoginModal);
  loginOverlay.addEventListener("click", (e) => { if (e.target === loginOverlay) closeLoginModal(); });

  // Oldingi sessiyani server orqali tiklash
  if (sessionToken) {
    api("me").then((r) => {
      if (r.ok) setUser(r.user);
      else if (r.error === "login") setSession(null);
    });
  }

  /* ======================================================================
     CHECKOUT (lokatsiya majburiy) -> api.php -> admin bot
     ====================================================================== */
  const checkoutOverlay = document.getElementById("checkoutModalOverlay");
  const successOverlay = document.getElementById("successModalOverlay");
  const locStatus = document.getElementById("locStatus");
  let orderLocation = null; // { lat, lng, acc }

  function setLocStatus(text, kind) {
    locStatus.textContent = text;
    locStatus.className = "loc-status" + (kind ? " " + kind : "");
  }
  function requestLocation() {
    orderLocation = null;
    if (!navigator.geolocation) { setLocStatus("Brauzeringiz lokatsiyani qo'llab-quvvatlamaydi", "bad"); return; }
    if (!window.isSecureContext) { setLocStatus("Lokatsiya faqat https:// saytda ishlaydi", "bad"); return; }
    setLocStatus("Aniqlanmoqda... brauzer so'rasa «Ruxsat berish» ni bosing");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        orderLocation = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) };
        setLocStatus("✅ Lokatsiya aniqlandi (±" + orderLocation.acc + " m)", "ok");
      },
      (err) => {
        const msg = err.code === 1
          ? "Ruxsat berilmagan. Brauzer manzil satridagi 🔒 belgisi orqali lokatsiyaga ruxsat bering va qayta bosing"
          : "Lokatsiyani aniqlab bo'lmadi. GPS/internetni yoqib, qayta bosing";
        setLocStatus(msg, "bad");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }
  document.getElementById("locBtn").addEventListener("click", requestLocation);

  function openCheckout() {
    if (cart.length === 0) return;
    document.getElementById("checkoutAmount").textContent = money(cartTotal());
    const nameEl = document.getElementById("checkoutName");
    const phoneEl = document.getElementById("checkoutPhone");
    if (!nameEl.value) nameEl.value = currentUser.name || "";
    if (!phoneEl.value) phoneEl.value = currentUser.phone || "";
    const box = document.getElementById("savedAddresses");
    box.innerHTML = "";
    (currentUser.addresses || []).forEach((a) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "saved-address-chip"; b.textContent = a;
      b.addEventListener("click", () => { document.getElementById("checkoutAddress").value = a; });
      box.appendChild(b);
    });
    checkoutOverlay.classList.add("show");
    markModalOpen("checkout");
    requestLocation();
  }
  function closeCheckout() { checkoutOverlay.classList.remove("show"); markModalClosed("checkout"); }

  document.getElementById("checkoutBtn").addEventListener("click", () => {
    if (cart.length === 0) return;
    if (!currentUser) {
      pendingCheckout = true;
      openLogin("Buyurtma berish uchun avval Google hisobingiz bilan kiring");
      pendingCheckout = true; // openLogin holatni tozalamaydi, lekin aniqlik uchun
      return;
    }
    openCheckout();
  });
  document.getElementById("closeCheckoutBtn").addEventListener("click", closeCheckout);
  checkoutOverlay.addEventListener("click", (e) => { if (e.target === checkoutOverlay) closeCheckout(); });

  document.getElementById("checkoutForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (cart.length === 0 || !currentUser) return;
    if (!orderLocation) {
      showToast("Buyurtma uchun lokatsiya kerak. «Lokatsiyamni aniqlash» tugmasini bosing", "Lokatsiya yo'q 📍");
      requestLocation();
      return;
    }
    const submitBtn = document.getElementById("checkoutSubmitBtn");
    const originalBtnText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Yuborilmoqda...";

    api("order", {
      name: document.getElementById("checkoutName").value.trim(),
      phone: document.getElementById("checkoutPhone").value.trim(),
      address: document.getElementById("checkoutAddress").value.trim(),
      lat: orderLocation.lat, lng: orderLocation.lng, acc: orderLocation.acc,
      base: window.location.href,
      items: cart.map((i) => ({ name: i.name, qty: i.qty, price: i.price, image: i.image })),
    }).then((r) => {
      submitBtn.disabled = false;
      submitBtn.textContent = originalBtnText;
      if (r.ok) {
        setUser(r.user);
        closeCheckout();
        closeCart();
        successOverlay.classList.add("show");
        markModalOpen("success");
        cart = [];
        updateCartUI();
        e.target.reset();
        orderLocation = null;
        setLocStatus("Lokatsiya aniqlanmagan");
      } else if (r.error === "login") {
        setSession(null); setUser(null); closeCheckout(); pendingCheckout = true;
        openLogin("Sessiya tugadi. Qayta kiring");
      } else {
        showToast("Iltimos, qayta urinib ko'ring yoki bizga qo'ng'iroq qiling", "Buyurtma yuborilmadi ⚠️");
      }
    });
  });

  document.getElementById("closeSuccessBtn").addEventListener("click", () => {
    successOverlay.classList.remove("show");
    markModalClosed("success");
  });

  /* ======================================================================
     PROFIL (ma'lumotlar serverdan: Gmail, telefon, buyurtmalar, manzillar)
     ====================================================================== */
  function renderProfile() {
    const u = currentUser;
    const av = document.getElementById("profileAvatar");
    av.innerHTML = u && u.picture ? `<img src="${escapeHtml(u.picture)}" alt="" referrerpolicy="no-referrer">` : "👤";
    document.getElementById("profileName").textContent = u ? (u.name || "Mijoz") : "Mehmon";
    document.getElementById("profileEmail").textContent = u ? u.email : "Kirish qilinmagan";
    document.getElementById("profilePhone").textContent = u && u.phone ? u.phone : "";
    document.getElementById("profileGoogleBtn").style.display = u ? "none" : "block";
    document.getElementById("profileLogoutBtn").style.display = u ? "block" : "none";

    const orders = u ? u.orders || [] : [];
    const ordersEl = document.getElementById("profileOrders");
    ordersEl.innerHTML = "";
    document.getElementById("profileOrdersEmpty").classList.toggle("show", orders.length === 0);
    orders.forEach((o) => {
      const items = o.items || [];
      const thumbs = items.slice(0, 3).map((it) => `<img class="profile-order-thumb" src="${escapeHtml(it.image)}" alt="">`).join("")
        + (items.length > 3 ? `<span class="profile-order-thumb-more">+${items.length - 3}</span>` : "");
      const date = new Date(o.date).toLocaleDateString("uz-UZ", { day: "2-digit", month: "long", year: "numeric" });
      const card = document.createElement("div");
      card.className = "profile-order-card profile-order-full";
      card.innerHTML = `
        <div class="profile-order-thumbs">${thumbs}</div>
        <div class="profile-order-info">
          <p class="profile-order-date">#${escapeHtml(o.id)} · ${escapeHtml(date)}</p>
          <p class="profile-order-items">${items.map((i) => escapeHtml(i.name) + " ×" + i.qty).join(", ")}</p>
          <p class="profile-order-items">📍 ${escapeHtml(o.address)}</p>
          <p class="profile-order-status">${escapeHtml(o.status)}</p>
        </div>
        <p class="profile-order-total">${money(o.total)}</p>`;
      ordersEl.appendChild(card);
    });

    const addrs = u ? u.addresses || [] : [];
    const addrEl = document.getElementById("profileAddresses");
    addrEl.innerHTML = addrs.map((a) => `<p class="profile-address-row">📍 ${escapeHtml(a)}</p>`).join("");
    document.getElementById("profileAddressEmpty").classList.toggle("show", addrs.length === 0);
  }

  const profileOverlay = document.getElementById("profileOverlay");
  function openProfile() {
    renderProfile();
    profileOverlay.classList.add("show");
    markModalOpen("profile");
    if (currentUser) api("me").then((r) => { if (r.ok) { setUser(r.user); renderProfile(); } });
  }
  function closeProfile() { profileOverlay.classList.remove("show"); markModalClosed("profile"); }
  function openProfileGated() { if (currentUser) openProfile(); else openLogin(); }

  document.getElementById("closeProfileBtn").addEventListener("click", closeProfile);
  profileOverlay.addEventListener("click", (e) => { if (e.target === profileOverlay) closeProfile(); });
  document.getElementById("profileGoogleBtn").addEventListener("click", () => { closeProfile(); openLogin(); });
  document.getElementById("profileLogoutBtn").addEventListener("click", () => {
    api("logout");
    setSession(null);
    setUser(null);
    if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
    closeProfile();
    showToast("Profildan chiqdingiz", "Xayr! 👋");
  });

  /* ---------------- Init ---------------- */
  allCards.forEach((card) => {
    const descEl = card.querySelector(".product-desc");
    if (descEl) descEl.textContent = card.dataset.description || "";
  });

  /* ---------------- Mobile bottom nav ---------------- */
  const bottomNavHomeBtn = document.getElementById("bottomNavHomeBtn");
  const bottomNavCatBtn = document.getElementById("bottomNavCatBtn");
  const bottomNavCartBtn = document.getElementById("bottomNavCartBtn");
  const bottomNavWishlistBtn = document.getElementById("bottomNavWishlistBtn");
  const bottomNavProfileBtn = document.getElementById("bottomNavProfileBtn");

  if (bottomNavHomeBtn) {
    bottomNavHomeBtn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  }
  if (bottomNavCatBtn) {
    bottomNavCatBtn.addEventListener("click", () => {
      const el = document.querySelector(".cat-showcase");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  if (bottomNavCartBtn) bottomNavCartBtn.addEventListener("click", openCart);
  if (bottomNavWishlistBtn) bottomNavWishlistBtn.addEventListener("click", openWishlist);
  if (bottomNavProfileBtn) bottomNavProfileBtn.addEventListener("click", openProfileGated);

  if (window.AOS) {
    AOS.init({ duration: 600, once: true, offset: 40 });
  }

  render();
  updateCartUI();
  updateWishlistUI();
})();