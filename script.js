const header = document.querySelector("[data-header]");

const updateHeader = () => {
  header?.classList.toggle("is-scrolled", window.scrollY > 12);
};

window.addEventListener("scroll", updateHeader, { passive: true });
updateHeader();

const navMenus = [...document.querySelectorAll("[data-nav-menu]")];
navMenus.forEach((menu) => {
  menu.querySelector("summary")?.addEventListener("click", () => {
    const willOpen = !menu.open;
    if (!willOpen) return;
    navMenus.forEach((other) => {
      if (other !== menu) other.open = false;
    });
  });
});

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-nav-menu]")) return;
  navMenus.forEach((menu) => {
    menu.open = false;
  });
});

document.querySelectorAll("[data-waitlist-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const note = form.querySelector("[data-form-note]");
    const button = form.querySelector("button[type='submit']");
    const email = form.querySelector("[name='email']")?.value || "";
    const concern = form.querySelector("[name='concern']")?.value || "";
    const consent = Boolean(form.querySelector("[name='consent']")?.checked);

    if (button) {
      button.disabled = true;
      button.textContent = "Saving your place...";
    }
    if (note) note.textContent = "";

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, concern, consent }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "We could not save your place right now.");
      if (note) note.textContent = result.message;
      form.reset();
      if (button) button.textContent = "You are on the list";
    } catch (error) {
      if (note) note.textContent = error.message || "We could not save your place right now. Please try again.";
      if (button) button.textContent = "Join the Waitlist";
    } finally {
      if (button) button.disabled = false;
    }
  });
});

document.querySelectorAll("[data-checklist]").forEach((container) => {
  const key = `woafypet-checklist:${container.dataset.checklist}`;
  const note = container.querySelector("[data-checklist-note]");
  const checks = [...container.querySelectorAll("[data-check-item]")];
  const fields = [...container.querySelectorAll("[data-note-field]")];

  const readState = () => {
    try {
      return JSON.parse(localStorage.getItem(key) || "{}");
    } catch {
      return {};
    }
  };

  const writeState = () => {
    const state = {
      checks: checks.map((input) => input.checked),
      fields: fields.map((field) => field.value),
    };
    localStorage.setItem(key, JSON.stringify(state));
    if (note) note.textContent = "Saved for this device.";
  };

  const state = readState();
  checks.forEach((input, index) => {
    input.checked = Boolean(state.checks?.[index]);
    input.addEventListener("change", writeState);
  });
  fields.forEach((field, index) => {
    field.value = state.fields?.[index] || "";
    field.addEventListener("input", writeState);
  });

  container.querySelector("[data-reset-checklist]")?.addEventListener("click", () => {
    checks.forEach((input) => {
      input.checked = false;
    });
    fields.forEach((field) => {
      field.value = "";
    });
    localStorage.removeItem(key);
    if (note) note.textContent = "Cleared.";
  });
});

const directorySearch = document.querySelector("[data-directory-search]");
const directoryCategory = document.querySelector("[data-directory-category]");
const directoryCoverage = document.querySelector("[data-directory-coverage]");
const directoryCards = [...document.querySelectorAll("[data-directory-item]")];
const directoryEmpty = document.querySelector("[data-directory-empty]");
const directoryResultCount = document.querySelector("[data-directory-results-count]");

const filterDirectory = () => {
  const query = (directorySearch?.value || "").trim().toLowerCase();
  const category = directoryCategory?.value || "all";
  const coverage = directoryCoverage?.value || "all";
  let visible = 0;

  directoryCards.forEach((card) => {
    const matchesQuery = !query || (card.dataset.search || "").toLowerCase().includes(query);
    const matchesCategory = category === "all" || (card.dataset.categories || "").split("|").includes(category);
    const cardCoverage = card.dataset.coverage || "all";
    const matchesCoverage = coverage === "all" || cardCoverage === "all" || cardCoverage === coverage;
    const show = matchesQuery && matchesCategory && matchesCoverage;
    card.hidden = !show;
    if (show && card.hasAttribute("data-directory-profile")) visible += 1;
  });

  if (directoryEmpty) directoryEmpty.hidden = visible > 0;
  if (directoryResultCount) directoryResultCount.textContent = `${visible} ${visible === 1 ? "result" : "results"}`;
};

directorySearch?.addEventListener("input", filterDirectory);
directoryCategory?.addEventListener("change", filterDirectory);
directoryCoverage?.addEventListener("change", filterDirectory);
filterDirectory();

const resourceSearch = document.querySelector("[data-resource-search]");
const resourceSort = document.querySelector("[data-resource-sort]");
const resourceCards = [...document.querySelectorAll("[data-resource-card]")];
const resourceEmpty = document.querySelector("[data-resource-empty]");
const resourceFilters = [...document.querySelectorAll("[data-resource-filter]")];
let activeResourceFilter = "all";

const filterResources = () => {
  const query = (resourceSearch?.value || "").trim().toLowerCase();
  let visible = 0;
  resourceCards.forEach((card) => {
    const title = card.dataset.title.toLowerCase();
    const category = card.dataset.category || "";
    const matchesQuery = !query || title.includes(query);
    const matchesFilter =
      activeResourceFilter === "all" ||
      (activeResourceFilter === "care" && !category.includes("bobby") && !category.includes("first-time")) ||
      (activeResourceFilter === "guide" && (category.includes("vet") || category.includes("comfort") || category.includes("quality"))) ||
      (activeResourceFilter === "story" && (category.includes("bobby") || category.includes("first-time")));
    const show = matchesQuery && matchesFilter;
    card.hidden = !show;
    if (show) visible += 1;
  });
  if (resourceEmpty) resourceEmpty.hidden = visible > 0;
};

const sortResources = () => {
  if (!resourceSort || resourceCards.length === 0) return;
  const parent = resourceCards[0].parentElement;
  const sorted = [...resourceCards].sort((a, b) => {
    if (resourceSort.value === "shortest") return Number(a.dataset.read || 0) - Number(b.dataset.read || 0);
    if (resourceSort.value === "practical") return a.dataset.title.localeCompare(b.dataset.title);
    return 0;
  });
  sorted.forEach((card) => parent.appendChild(card));
};

resourceFilters.forEach((button) => {
  button.addEventListener("click", () => {
    activeResourceFilter = button.dataset.resourceFilter || "all";
    resourceFilters.forEach((item) => item.classList.toggle("is-active", item === button));
    filterResources();
  });
});

resourceSearch?.addEventListener("input", filterResources);
resourceSort?.addEventListener("change", () => {
  sortResources();
  filterResources();
});
sortResources();
filterResources();

const topicSearch = document.querySelector("[data-topic-search]");
const topicClear = document.querySelector("[data-topic-clear]");
const topicCards = [...document.querySelectorAll("[data-topic-card]")];
const topicEmpty = document.querySelector("[data-topic-empty]");

const filterTopics = () => {
  const query = (topicSearch?.value || "").trim().toLowerCase();
  let visible = 0;
  topicCards.forEach((card) => {
    const show = !query || card.dataset.title.toLowerCase().includes(query);
    card.hidden = !show;
    if (show) visible += 1;
  });
  if (topicEmpty) topicEmpty.hidden = visible > 0;
};

topicSearch?.addEventListener("input", filterTopics);
topicClear?.addEventListener("click", () => {
  if (topicSearch) topicSearch.value = "";
  filterTopics();
});
filterTopics();

const memberStorageKey = "woafypet-care-circle-member";
const pendingLessonKey = "woafypet-pending-lesson";

const readMember = () => {
  try {
    const member = JSON.parse(localStorage.getItem(memberStorageKey) || "null");
    return member?.id && member?.token && member?.dogId && member?.dogName ? member : null;
  } catch {
    return null;
  }
};

const saveMember = (member) => {
  localStorage.setItem(memberStorageKey, JSON.stringify(member));
  return member;
};

const localPreview = ["127.0.0.1", "localhost"].includes(window.location.hostname);
const localPetsStorageKey = "woafmeow-local-pets-v1";
const readLocalPets = () => {
  try { return JSON.parse(localStorage.getItem(localPetsStorageKey) || "[]"); } catch { return []; }
};
const saveLocalPets = (pets) => localStorage.setItem(localPetsStorageKey, JSON.stringify(pets));

const localAccountRequest = async (url, payload) => {
  if (url === "/api/enroll") {
    const dogId = `pet_${crypto.randomUUID()}`;
    const member = {
      id: `member_${crypto.randomUUID()}`,
      token: crypto.randomUUID(),
      dogId,
      dogName: payload.dogName,
      species: payload.species,
      breed: payload.breed,
      ageYears: payload.ageYears,
      weightLbs: payload.weightLbs,
      focus: payload.focus,
      healthConditions: payload.healthConditions,
      medications: payload.medications,
      routineNotes: payload.routineNotes,
      firstName: payload.ownerName,
      email: payload.email,
      location: payload.location,
      membershipPlan: "free",
    };
    saveLocalPets([member]);
    return { member, pet: member, message: `${payload.dogName}'s care account is ready.` };
  }
  if (url === "/api/pets") {
    const member = readMember();
    if (!member || member.membershipPlan === "free") throw new Error("Care+ members can add more than one pet.");
    const pet = { ...payload, dogId: `pet_${crypto.randomUUID()}` };
    saveLocalPets([...readLocalPets(), pet]);
    return { pet, message: `${payload.dogName} was added.` };
  }
  return null;
};

document.querySelectorAll("[data-account-signout]").forEach((link) => {
  link.addEventListener("click", () => {
    localStorage.removeItem(memberStorageKey);
  });
});

const requestJson = async (url, payload, extraHeaders = {}) => {
  if (localPreview && ["/api/enroll", "/api/pets"].includes(url)) {
    return localAccountRequest(url, payload);
  }
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...extraHeaders },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "We could not save that right now. Please try again.");
  return result;
};

document.querySelectorAll("[data-session-interest-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const note = form.querySelector("[data-session-interest-note]");
    const button = form.querySelector("button[type='submit']");
    const values = Object.fromEntries(new FormData(form).entries());
    const payload = {
      ...values,
      sessionSlug: form.dataset.sessionSlug || "next-live-care-session",
      sessionTitle: form.dataset.sessionTitle || "Next live Care Session",
      consent: Boolean(form.querySelector("[name='consent']")?.checked),
    };
    const original = button?.textContent || "Reserve my place";

    if (button) {
      button.disabled = true;
      button.textContent = "Saving your place...";
    }
    if (note) note.textContent = "";
    try {
      const result = await requestJson("/api/session-interest", payload);
      if (note) note.textContent = result.message;
      form.reset();
      if (button) button.textContent = "Your place is saved";
    } catch (error) {
      if (note) note.textContent = error.message || "We could not save your session request right now.";
      if (button) button.textContent = original;
    } finally {
      if (button) button.disabled = false;
    }
  });
});

document.querySelectorAll("[data-newsletter-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const note = form.querySelector("[data-newsletter-note]");
    const button = form.querySelector("button[type='submit']");
    const email = form.querySelector("[name='email']")?.value || "";
    const consent = Boolean(form.querySelector("[name='consent']")?.checked);
    if (button) {
      button.disabled = true;
      button.textContent = "Signing up...";
    }
    if (note) note.textContent = "";
    try {
      const result = await requestJson("/api/newsletter", { email, consent });
      if (note) note.textContent = result.message;
      form.reset();
      if (button) button.textContent = "You are signed up";
    } catch (error) {
      if (note) note.textContent = error.message || "We could not save your signup right now.";
      if (button) button.textContent = "Sign up";
    } finally {
      if (button) button.disabled = false;
    }
  });
});

document.querySelectorAll("[data-contact-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const note = form.querySelector("[data-contact-note]");
    const button = form.querySelector("button[type='submit']");
    const original = button?.textContent || "Send message";
    const values = Object.fromEntries(new FormData(form).entries());
    const payload = { ...values, consent: Boolean(form.querySelector("[name='consent']")?.checked) };
    if (button) {
      button.disabled = true;
      button.textContent = "Sending...";
    }
    if (note) note.textContent = "";
    try {
      const result = await requestJson("/api/contact", payload);
      if (note) note.textContent = result.message;
      form.reset();
      if (button) button.textContent = "Message sent";
    } catch (error) {
      if (note) note.textContent = error.message || "We could not send that message right now.";
      if (button) button.textContent = original;
    } finally {
      if (button) button.disabled = false;
    }
  });
});

document.querySelectorAll("[data-memorial-interest-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const note = form.querySelector("[data-memorial-interest-note]");
    const button = form.querySelector("button[type='submit']");
    const values = Object.fromEntries(new FormData(form).entries());
    const original = button?.textContent || "Keep me informed";
    const payload = { ...values, consent: Boolean(form.querySelector("[name='consent']")?.checked) };

    if (button) {
      button.disabled = true;
      button.textContent = "Saving your request...";
    }
    if (note) note.textContent = "";
    try {
      const result = await requestJson("/api/memorial-interest", payload);
      if (note) note.textContent = result.message;
      form.reset();
      if (button) button.textContent = "You are on the list";
    } catch (error) {
      if (note) note.textContent = error.message || "We could not save that request right now.";
      if (button) button.textContent = original;
    } finally {
      if (button) button.disabled = false;
    }
  });
});

document.querySelectorAll("[data-vendor-application-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const note = form.querySelector("[data-vendor-application-note]");
    const button = form.querySelector("button[type='submit']");
    const values = Object.fromEntries(new FormData(form).entries());
    if (button) { button.disabled = true; button.textContent = "Submitting..."; }
    if (note) note.textContent = "";
    try {
      const result = await requestJson("/api/vendor-application", { ...values, consent: Boolean(form.querySelector("[name='consent']")?.checked) });
      if (note) note.textContent = result.message;
      form.reset();
      if (button) button.textContent = "Application received";
    } catch (error) {
      if (note) note.textContent = error.message || "We could not save that application right now.";
      if (button) button.textContent = "Submit application";
    } finally {
      if (button) button.disabled = false;
    }
  });
});

document.querySelectorAll("[data-membership-interest-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const member = readMember();
    const note = form.querySelector("[data-membership-interest-note]");
    const button = form.querySelector("button[type='submit']");
    const values = Object.fromEntries(new FormData(form).entries());
    if (button) { button.disabled = true; button.textContent = "Joining..."; }
    try {
      const result = await requestJson("/api/membership-interest", {
        email: values.email,
        monthlyStory: Boolean(form.querySelector("[name='monthlyStory']")?.checked),
        yearbook: Boolean(form.querySelector("[name='yearbook']")?.checked),
        patternWatch: Boolean(form.querySelector("[name='patternWatch']")?.checked),
        memoryStorage: Boolean(form.querySelector("[name='memoryStorage']")?.checked),
        consent: Boolean(form.querySelector("[name='consent']")?.checked),
        memberId: member?.id || "",
        memberToken: member?.token || "",
      });
      if (note) note.textContent = result.message;
      if (button) button.textContent = "You are on the list";
    } catch (error) {
      if (note) note.textContent = error.message || "We could not save that request.";
      if (button) button.textContent = "Join Care+ launch list";
    } finally {
      if (button) button.disabled = false;
    }
  });
});

const membershipPlanForm = document.querySelector("[data-membership-checkout]");
const membershipPrice = document.querySelector("[data-plan-price]");
const membershipPeriod = document.querySelector("[data-plan-period]");
const membershipAnnualBenefits = document.querySelectorAll("[data-annual-benefit], [data-annual-note]");
document.querySelectorAll("[data-billing]").forEach((button) => {
  button.addEventListener("click", () => {
    const plan = button.dataset.billing === "annual" ? "annual" : "monthly";
    document.querySelectorAll("[data-billing]").forEach((item) => item.classList.toggle("active", item === button));
    if (membershipPlanForm) membershipPlanForm.elements.plan.value = plan;
    if (membershipPrice) membershipPrice.textContent = plan === "annual" ? "$135" : "$14";
    if (membershipPeriod) membershipPeriod.textContent = plan === "annual" ? "/ year" : "/ month";
    membershipAnnualBenefits.forEach((node) => { node.hidden = plan !== "annual"; });
  });
});

if (membershipPlanForm) {
  const member = readMember();
  if (member?.email && membershipPlanForm.elements.email) membershipPlanForm.elements.email.value = member.email;
  membershipPlanForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = membershipPlanForm.querySelector("button[type='submit']");
    const note = membershipPlanForm.querySelector("[data-membership-checkout-note]");
    const activeMember = readMember();
    if (button) { button.disabled = true; button.textContent = "Opening secure checkout..."; }
    if (note) note.textContent = "";
    try {
      const result = await requestJson("/api/membership-checkout", {
        email: membershipPlanForm.elements.email.value,
        plan: membershipPlanForm.elements.plan.value,
        memberId: activeMember?.id || "",
        memberToken: activeMember?.token || "",
      });
      if (result.checkoutUrl) window.location.href = result.checkoutUrl;
      else if (note) note.textContent = result.message;
    } catch (error) {
      if (note) note.textContent = error.message || "Secure checkout could not be opened.";
    } finally {
      if (button) { button.disabled = false; button.textContent = "Continue to secure payment"; }
    }
  });
}

const cartStorageKey = "woafmeow-marketplace-cart";
const shopOfferStorageKey = "woafmeow-shop-coupon";
const shopOfferDismissedKey = "woafmeow-shop-offer-dismissed";
const readCart = () => {
  try {
    const value = JSON.parse(localStorage.getItem(cartStorageKey) || "[]");
    return Array.isArray(value) ? value.filter((item) => item?.slug && item?.title && Number(item?.priceCents) > 0) : [];
  } catch {
    return [];
  }
};
const saveCart = (cart) => localStorage.setItem(cartStorageKey, JSON.stringify(cart));
const readShopCoupon = () => localStorage.getItem(shopOfferStorageKey) === "WELCOME15" ? "WELCOME15" : "";
const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
const cartRoot = document.querySelector("[data-shop-cart]");
const cartBackdrop = document.querySelector("[data-cart-backdrop]");

const openCart = () => {
  if (!cartRoot) return;
  cartRoot.hidden = false;
  if (cartBackdrop) cartBackdrop.hidden = false;
  document.body.classList.add("cart-open");
};

const closeCart = () => {
  if (!cartRoot) return;
  cartRoot.hidden = true;
  if (cartBackdrop) cartBackdrop.hidden = true;
  document.body.classList.remove("cart-open");
};

const renderCart = () => {
  const cart = readCart();
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cart.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
  const discount = readShopCoupon() ? Math.round(subtotal * 0.15) : 0;
  const total = Math.max(0, subtotal - discount);
  document.querySelectorAll("[data-cart-count]").forEach((node) => { node.textContent = `${count}${node.closest("header") ? count === 1 ? " item" : " items" : ""}`; });
  document.querySelectorAll("[data-cart-subtotal]").forEach((node) => { node.textContent = money(subtotal); });
  document.querySelectorAll("[data-cart-discount]").forEach((node) => { node.textContent = `-${money(discount)}`; });
  document.querySelectorAll("[data-cart-discount-row]").forEach((node) => { node.hidden = discount === 0; });
  document.querySelectorAll("[data-cart-total]").forEach((node) => { node.textContent = money(total); });
  document.querySelectorAll("[data-cart-empty]").forEach((node) => { node.hidden = cart.length > 0; });
  document.querySelectorAll("[data-shop-checkout]").forEach((node) => { node.hidden = cart.length === 0; });
  document.querySelectorAll("[data-cart-items]").forEach((root) => {
    root.replaceChildren();
    cart.forEach((item) => {
      const row = document.createElement("article");
      const image = document.createElement("img");
      image.src = item.image;
      image.alt = "";
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = item.title;
      const price = document.createElement("span");
      price.textContent = money(item.priceCents);
      if (item.note) {
        const note = document.createElement("small");
        note.textContent = item.note;
        copy.append(title, price, note);
      } else copy.append(title, price);
      const controls = document.createElement("div");
      controls.className = "cart-item-controls";
      [["−", -1], [String(item.quantity), 0], ["+", 1]].forEach(([label, delta]) => {
        const control = document.createElement(delta === 0 ? "span" : "button");
        control.textContent = label;
        if (delta !== 0) {
          control.type = "button";
          control.addEventListener("click", () => {
            const next = readCart();
            const current = next.find((entry) => entry.slug === item.slug && entry.note === item.note);
            if (current) current.quantity = Math.max(0, Math.min(8, current.quantity + delta));
            saveCart(next.filter((entry) => entry.quantity > 0));
            renderCart();
          });
        }
        controls.append(control);
      });
      copy.append(controls);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "cart-item-remove";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        saveCart(readCart().filter((entry) => !(entry.slug === item.slug && entry.note === item.note)));
        renderCart();
      });
      row.append(image, copy, remove);
      root.append(row);
    });
  });
};

const addCartItem = ({ slug, title, priceCents, image, note = "", quantity = 1 }) => {
  const cart = readCart();
  const existing = cart.find((item) => item.slug === slug && item.note === note);
  if (existing) existing.quantity = Math.min(8, existing.quantity + quantity);
  else cart.push({ slug, title, priceCents: Number(priceCents), image, note, quantity });
  saveCart(cart);
  renderCart();
  openCart();
};

document.querySelectorAll("[data-add-cart]").forEach((button) => {
  button.addEventListener("click", () => {
    const detail = button.closest(".product-detail-copy");
    const choices = [...(detail?.querySelectorAll("[data-product-option]") || [])].map((field) => `${field.dataset.optionLabel}: ${field.value}`);
    const personalization = detail?.querySelector("[data-product-note]")?.value.trim() || "";
    const note = [...choices, personalization].filter(Boolean).join(" · ");
    const quantity = Math.max(1, Math.min(3, Number(detail?.querySelector("[data-product-quantity]")?.value || 1)));
    addCartItem({
      slug: button.dataset.productSlug,
      title: button.dataset.productTitle,
      priceCents: Number(button.dataset.productPrice),
      image: button.dataset.productImage,
      note,
      quantity,
    });
    button.textContent = "Added";
    window.setTimeout(() => { button.textContent = "Add to cart"; }, 1200);
  });
});

const renderDynamicProducts = (products) => {
  const builtInProductSlugs = new Set([
    "living-memorial-tree",
    "photo-collar-memory-frame",
    "portrait-name-pendant",
    "hand-thrown-ceramic-urn",
    "portrait-signet-ring",
    "paw-print-bracelet",
    "custom-portrait-miniature",
    "custom-plush-portrait",
    "senior-pet-home-comfort-consult",
  ]);
  document.querySelectorAll("[data-dynamic-products]").forEach((root) => {
    root.replaceChildren();
    products.filter((product) => !builtInProductSlugs.has(product.slug)).forEach((product) => {
      const card = document.createElement("article");
      card.className = "product-card";
      const figure = document.createElement("figure");
      const image = document.createElement("img");
      image.src = product.imageUrl;
      image.alt = product.title;
      image.loading = "lazy";
      figure.append(image);
      const copy = document.createElement("div");
      const category = document.createElement("span");
      category.className = "product-badge";
      category.textContent = String(product.category || "Marketplace").replace(/-/g, " ");
      const title = document.createElement("h3");
      title.textContent = product.title;
      const description = document.createElement("p");
      description.textContent = product.shortDescription;
      const price = document.createElement("strong");
      price.className = "product-card-price";
      price.textContent = money(product.priceCents);
      copy.append(category, title, description, price);
      if (Array.isArray(product.details) && product.details.length) {
        const details = document.createElement("ul");
        details.className = "product-card-details";
        product.details.slice(0, 4).forEach((detail) => {
          const item = document.createElement("li");
          item.textContent = detail;
          details.append(item);
        });
        copy.append(details);
      }
      const button = document.createElement("button");
      button.className = "button primary";
      button.type = "button";
      button.textContent = "Add to cart";
      button.addEventListener("click", () => {
        addCartItem({
          slug: product.slug,
          title: product.title,
          priceCents: product.priceCents,
          image: product.imageUrl,
        });
        button.textContent = "Added";
        window.setTimeout(() => { button.textContent = "Add to cart"; }, 1200);
      });
      copy.append(button);
      card.append(figure, copy);
      root.append(card);
    });
  });
};

const loadDynamicProducts = async () => {
  if (!document.querySelector("[data-dynamic-products]")) return;
  try {
    const response = await fetch("/api/products", { headers: { accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) renderDynamicProducts(payload.products || []);
  } catch {
    // The built-in catalog remains available if the live catalog is unavailable.
  }
};

document.querySelectorAll("[data-product-thumb]").forEach((button) => {
  button.addEventListener("click", () => {
    const gallery = button.closest(".product-gallery");
    const main = gallery?.querySelector("[data-product-main-image]");
    if (!main) return;
    main.src = button.dataset.src;
    gallery.querySelectorAll("[data-product-thumb]").forEach((item) => item.classList.toggle("is-active", item === button));
  });
});

document.querySelectorAll("[data-cart-open]").forEach((button) => button.addEventListener("click", openCart));
document.querySelectorAll("[data-cart-close]").forEach((button) => button.addEventListener("click", closeCart));
cartBackdrop?.addEventListener("click", closeCart);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeCart();
  if (typeof closeShopOffer === "function") closeShopOffer();
});

document.querySelectorAll("[data-shop-promo-form]").forEach((form) => {
  const field = form.querySelector("[name='coupon']");
  const note = form.querySelector("[data-shop-promo-note]");
  if (field && readShopCoupon()) field.value = readShopCoupon();
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if ((field?.value || "").trim().toUpperCase() !== "WELCOME15") {
      if (note) note.textContent = "That code is not recognized.";
      return;
    }
    localStorage.setItem(shopOfferStorageKey, "WELCOME15");
    if (note) note.textContent = "15% welcome offer applied.";
    renderCart();
  });
});

const shopOffer = document.querySelector("[data-shop-offer]");
const shopOfferBackdrop = document.querySelector("[data-shop-offer-backdrop]");
const closeShopOffer = ({ remember = true } = {}) => {
  if (!shopOffer) return;
  shopOffer.hidden = true;
  if (shopOfferBackdrop) shopOfferBackdrop.hidden = true;
  document.body.classList.remove("shop-offer-open");
  if (remember) sessionStorage.setItem(shopOfferDismissedKey, "1");
};
const openShopOffer = () => {
  if (!shopOffer || readShopCoupon() || sessionStorage.getItem(shopOfferDismissedKey)) return;
  shopOffer.hidden = false;
  if (shopOfferBackdrop) shopOfferBackdrop.hidden = false;
  document.body.classList.add("shop-offer-open");
};
document.querySelectorAll("[data-shop-offer-close]").forEach((button) => button.addEventListener("click", () => closeShopOffer()));
shopOfferBackdrop?.addEventListener("click", () => closeShopOffer());
document.querySelectorAll("[data-shop-offer-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const note = form.querySelector("[data-shop-offer-note]");
    const button = form.querySelector("button[type='submit']");
    const email = form.querySelector("[name='email']")?.value || "";
    const consent = Boolean(form.querySelector("[name='consent']")?.checked);
    if (button) {
      button.disabled = true;
      button.textContent = "Saving...";
    }
    if (note) note.textContent = "";
    try {
      await requestJson("/api/newsletter", { email, consent });
      localStorage.setItem(shopOfferStorageKey, "WELCOME15");
      if (note) note.textContent = "WELCOME15 is ready and has been applied.";
      if (button) button.textContent = "15% applied";
      renderCart();
      window.setTimeout(() => closeShopOffer({ remember: false }), 900);
    } catch (error) {
      if (note) note.textContent = error.message || "We could not save your email right now.";
      if (button) button.textContent = "Get 15% off";
    } finally {
      if (button) button.disabled = false;
    }
  });
});
if (shopOffer) window.setTimeout(openShopOffer, 1200);

document.querySelectorAll("[data-shop-checkout-full]").forEach((form) => {
  const member = readMember();
  if (member?.email && form.elements.email) form.elements.email.value = member.email;
  if (member?.firstName && form.elements.firstName) form.elements.firstName.value = member.firstName;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const cart = readCart();
    const button = form.querySelector("button[type='submit']");
    const note = form.querySelector("[data-shop-checkout-note]");
    if (!cart.length) {
      if (note) note.textContent = "Your cart is empty. Add an item before checkout.";
      return;
    }
    const values = Object.fromEntries(new FormData(form).entries());
    const activeMember = readMember();
    if (button) { button.disabled = true; button.textContent = "Opening secure payment..."; }
    if (note) note.textContent = "";
    try {
      const result = await requestJson("/api/store-checkout", {
        ...values,
        name: `${values.firstName || ""} ${values.lastName || ""}`.trim(),
        items: cart,
        coupon: readShopCoupon(),
        memberId: activeMember?.id || "",
        memberToken: activeMember?.token || "",
      });
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }
      if (note) note.textContent = result.message || "Your order details are saved.";
    } catch (error) {
      if (note) note.textContent = error.message || "Secure checkout could not be opened.";
    } finally {
      if (button) { button.disabled = false; button.textContent = "Continue to secure payment"; }
    }
  });
});

renderCart();
loadDynamicProducts();

const checkoutStatus = new URLSearchParams(window.location.search).get("checkout");
if (checkoutStatus === "success" || checkoutStatus === "cancelled") {
  if (checkoutStatus === "success") saveCart([]);
  const message = document.createElement("div");
  message.className = `checkout-status ${checkoutStatus}`;
  message.textContent = checkoutStatus === "success" ? "Checkout completed. Check your email for confirmation." : "Checkout was closed. Nothing was charged.";
  document.querySelector("main")?.prepend(message);
}

const memberHeaders = (member) =>
  member ? { "x-care-circle-member": member.id, "x-care-circle-token": member.token } : {};

const sevenDayPrompts = {
  dog: [
    "How does the first rise after rest look today? Notice the pause, the first few steps, and whether movement gets easier.",
    "How does your pet settle this evening? Note pacing, room changes, panting, or what helps them rest.",
    "How did appetite and water compare with the usual routine today?", 
    "What route felt different today: stairs, a jump, a walk, or getting to a favorite room?",
    "What still brought clear joy today: greeting, food, a walk, people, or a familiar place?",
    "What did you notice that would be hard to remember exactly at a vet visit?",
    "Looking across the week, what pattern feels worth bringing to the next veterinary conversation?",
  ],
  cat: [
    "How did your cat get up, step down, or choose a jump today? Notice a lower route or longer pause without asking them to repeat it.",
    "How did your cat settle today? Note hiding, a new sleep place, restlessness, or what made a familiar place easier to use.",
    "How did appetite and water compare with the usual routine today?", 
    "How did the litter-box routine look today: frequency, hesitation, time in the box, vocalizing, or a change in output?",
    "What still brought clear joy today: a window, food, a person, grooming, play, or a familiar place?",
    "What did you notice that would be hard to remember exactly at a vet visit?",
    "Looking across the week, what pattern feels worth bringing to the next veterinary conversation?",
  ],
};

const trackerPromptFor = (member, dayNumber) => {
  const prompts = sevenDayPrompts[member?.species] || sevenDayPrompts.dog;
  return prompts[Math.max(1, Math.min(7, Number(dayNumber) || 1)) - 1];
};

const applyTrackerPrompt = (form, member) => {
  const day = form.querySelector("[data-tracker-day]");
  const promptNode = form.querySelector("[data-tracker-prompt]");
  if (!promptNode) return;
  const prompt = trackerPromptFor(member, day?.value || 1);
  promptNode.textContent = prompt;
  form.dataset.trackerPrompt = prompt;
};

const stateLabels = {
  same: "About the same",
  different: "Different lately",
  "not-sure": "Not sure",
};

const loadCareRecord = async (member) => {
  const response = await fetch(`/api/checkin?dogId=${encodeURIComponent(member.dogId)}`, {
    headers: { accept: "application/json", ...memberHeaders(member) },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "We could not load your care record right now.");
  return result;
};

const renderVetSummary = (panel, member, entries) => {
  panel.replaceChildren();
  const title = document.createElement("h3");
  title.textContent = `${member.dogName}'s care record`;
  const intro = document.createElement("p");
  intro.textContent = entries.length
    ? `Here are the ${entries.length} most recent observations saved in this profile. Keep the examples that best match the current concern.`
    : "Save at least one day before you prepare a summary for a veterinary visit.";
  panel.append(title, intro);

  if (!entries.length) return;

  const list = document.createElement("ol");
  list.className = "vet-summary-list";
  entries.slice().reverse().forEach((entry) => {
    const item = document.createElement("li");
    const heading = document.createElement("strong");
    heading.textContent = `Day ${entry.dayNumber || "saved observation"}`;
    const prompt = document.createElement("span");
    prompt.textContent = entry.prompt || "Observation";
    const states = document.createElement("span");
    states.textContent = `Sleep: ${stateLabels[entry.sleep] || entry.sleep}; movement: ${stateLabels[entry.mobility] || entry.mobility}; appetite: ${stateLabels[entry.appetite] || entry.appetite}.`;
    item.append(heading, prompt, states);
    if (entry.note) {
      const note = document.createElement("p");
      note.textContent = entry.note;
      item.append(note);
    }
    list.append(item);
  });
  panel.append(list);
};

const accountFocusLabels = {
  mobility: "Mobility and movement",
  sleep: "Sleep and settling",
  appetite: "Appetite and routine",
  comfort: "Comfort at home",
  "vet-visit": "Vet visit preparation",
  "not-sure": "A care baseline",
};

let accountPetProfiles = [];
let accountOwner = {};
let accountProfilePhotoUrl = "";

const accountValue = (selector, value) => {
  document.querySelectorAll(selector).forEach((node) => { node.textContent = value; });
};

const loadPrivateProfilePhoto = async (pet, member) => {
  const images = [...document.querySelectorAll("[data-profile-photo]")];
  const fallbacks = [...document.querySelectorAll("[data-profile-photo-fallback]")];
  const defaultPhoto = pet?.species === "cat"
    ? "/media/real/photo-55.jpg"
    : "/media/real/photo-01.jpg";
  images.forEach((image) => {
    image.src = defaultPhoto;
    image.alt = `${pet?.dogName || "Pet"} profile placeholder`;
    image.hidden = false;
  });
  fallbacks.forEach((node) => { node.hidden = true; });
  if (!pet?.profileMediaId || !member) return;
  try {
    const response = await fetch(`/api/media/${encodeURIComponent(pet.profileMediaId)}`, { headers: memberHeaders(member) });
    if (!response.ok) return;
    if (accountProfilePhotoUrl) URL.revokeObjectURL(accountProfilePhotoUrl);
    accountProfilePhotoUrl = URL.createObjectURL(await response.blob());
    images.forEach((image) => {
      image.src = accountProfilePhotoUrl;
      image.alt = `${pet.dogName}'s profile photo`;
      image.hidden = false;
    });
    fallbacks.forEach((node) => { node.hidden = true; });
  } catch {
    // The neutral species photo remains visible when a private image cannot be loaded.
  }
};

const fillPetEditForm = (pet) => {
  document.querySelectorAll("[data-edit-pet-form]").forEach((form) => {
    ["dogName", "species", "breed", "ageYears", "weightLbs", "focus", "healthConditions", "medications", "routineNotes"].forEach((name) => {
      const field = form.elements.namedItem(name);
      if (field) field.value = pet?.[name] ?? "";
    });
  });
};

const renderPetProfile = (pet, member = readMember()) => {
  if (!pet) return;
  accountValue("[data-profile-dog-name]", pet.dogName || "Your pet");
  accountValue("[data-account-pet-meta]", [pet.species === "cat" ? "Cat" : "Dog", pet.breed, pet.ageYears ? `${pet.ageYears} years old` : ""].filter(Boolean).join(" · "));
  accountValue("[data-account-age]", pet.ageYears ? `${pet.ageYears} years` : "Not added");
  accountValue("[data-account-breed]", pet.breed || "Not added");
  accountValue("[data-account-weight]", pet.weightLbs ? `${pet.weightLbs} lb` : "Not added");
  accountValue("[data-account-focus]", accountFocusLabels[pet.focus] || "A care baseline");
  accountValue("[data-account-conditions]", pet.healthConditions || "None added");
  accountValue("[data-account-medications]", pet.medications || "None added");
  accountValue("[data-account-routine]", pet.routineNotes || "None added");
  fillPetEditForm(pet);
  loadPrivateProfilePhoto(pet, member);
};

const renderAccountSnapshot = (member, result) => {
  const pet = result?.pet || {};
  const entries = Array.isArray(result?.entries) ? result.entries : [];
  document.querySelectorAll("[data-account-pet]").forEach((node) => {
    const details = [pet.name || member.dogName, pet.species || member.species].filter(Boolean);
    node.textContent = details.join(" · ");
  });
  document.querySelectorAll("[data-account-focus]").forEach((node) => {
    node.textContent = accountFocusLabels[pet.focus || member.focus] || "Care baseline";
  });
  document.querySelectorAll("[data-account-observation-count]").forEach((node) => {
    node.textContent = String(entries.length);
  });
};

const loadAccountSnapshot = async (member) => {
  if (!member || !document.querySelector("[data-account-overview]")) return;
  try {
    const result = await loadCareRecord(member);
    renderAccountSnapshot(member, result);
  } catch {
    renderAccountSnapshot(member, null);
  }
};

const activatePet = (owner, pet) => saveMember({
  ...readMember(),
  ...owner,
  ...pet,
  id: readMember()?.id,
  token: readMember()?.token,
});

const loadPetProfiles = async (member) => {
  const switches = [...document.querySelectorAll("[data-pet-switch]")];
  if (!member || !switches.length) return;
  if (localPreview) {
    const pets = readLocalPets().length ? readLocalPets() : [member];
    accountPetProfiles = pets;
    accountOwner = { firstName: member.firstName, email: member.email, location: member.location, membershipPlan: member.membershipPlan || "free" };
    const activePet = pets.find((pet) => pet.dogId === member.dogId) || pets[0];
    renderPetProfile(activePet, member);
    switches.forEach((select) => {
      select.replaceChildren(...pets.map((pet) => new Option(`${pet.dogName} · ${pet.species}`, pet.dogId)));
      select.value = activePet.dogId;
    });
    document.querySelectorAll("[data-add-pet-link]").forEach((link) => {
      link.href = member.membershipPlan === "free" || !member.membershipPlan ? "/membership/" : "/my-pet/?panel=add-pet#add-pet";
      link.textContent = member.membershipPlan === "free" || !member.membershipPlan ? "Care+ for more pets" : "Add another pet";
    });
    return;
  }
  try {
    const response = await fetch("/api/pets", { headers: { accept: "application/json", ...memberHeaders(member) } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "We could not load your pets.");
    const pets = Array.isArray(result.pets) ? result.pets : [];
    accountPetProfiles = pets;
    accountOwner = result.owner || {};
    const activePet = pets.find((pet) => pet.dogId === member.dogId) || pets[0];
    if (activePet) {
      activatePet({ firstName: result.owner?.firstName, email: result.owner?.email, location: result.owner?.location, membershipPlan: result.owner?.membershipPlan }, activePet);
      renderPetProfile(activePet, readMember());
    }
    const isFree = !result.owner?.membershipPlan || result.owner.membershipPlan === "free";
    document.querySelectorAll("[data-add-pet-link]").forEach((link) => {
      link.href = isFree ? "/membership/" : "/my-pet/?panel=add-pet#add-pet";
      link.textContent = isFree ? "Care+ for more pets" : "Add another pet";
    });
    document.querySelectorAll("[data-memory-member-gate]").forEach((gate) => { gate.hidden = !isFree; });
    document.querySelectorAll("[data-memory-member-content]").forEach((content) => { content.hidden = isFree; });
    switches.forEach((select) => {
      select.replaceChildren();
      pets.forEach((pet) => {
        const option = document.createElement("option");
        option.value = pet.dogId;
        option.textContent = `${pet.dogName} · ${pet.species}`;
        select.append(option);
      });
      select.value = pets.some((pet) => pet.dogId === member.dogId) ? member.dogId : pets[0]?.dogId || "";
      select.addEventListener("change", () => {
        const pet = pets.find((item) => item.dogId === select.value);
        if (!pet) return;
        activatePet({ firstName: result.owner?.firstName, email: result.owner?.email, location: result.owner?.location, membershipPlan: result.owner?.membershipPlan }, pet);
        window.location.reload();
      }, { once: true });
    });
  } catch {
    switches.forEach((select) => {
      select.replaceChildren();
      const option = document.createElement("option");
      option.value = member.dogId;
      option.textContent = member.dogName;
      select.append(option);
    });
  }
};

const renderNotifications = (items, unreadCount = 0) => {
  document.querySelectorAll("[data-notification-count]").forEach((badge) => {
    badge.textContent = String(unreadCount);
    badge.hidden = unreadCount < 1;
  });
  document.querySelectorAll("[data-notification-list]").forEach((root) => {
    root.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("p");
      empty.textContent = "You are all caught up.";
      root.append(empty);
      return;
    }
    items.forEach((item) => {
      const article = document.createElement("article");
      article.className = `notification-item${item.isRead ? "" : " is-unread"}`;
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = item.title;
      const body = document.createElement("p");
      body.textContent = item.body || "";
      copy.append(title, body);
      const link = document.createElement("a");
      link.href = item.href || "/my-pet/";
      link.textContent = "Open";
      article.append(copy, link);
      root.append(article);
    });
  });
};

const loadNotifications = async (member = readMember()) => {
  if (!member) return;
  try {
    const response = await fetch("/api/notifications", { headers: { accept: "application/json", ...memberHeaders(member) } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return;
    renderNotifications(Array.isArray(result.notifications) ? result.notifications : [], Number(result.unreadCount || 0));
  } catch {
    // Notification state is non-blocking.
  }
};

document.querySelectorAll("[data-notifications-read]").forEach((button) => {
  button.addEventListener("click", async () => {
    const member = readMember();
    if (!member) return;
    button.disabled = true;
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json", ...memberHeaders(member) },
        body: JSON.stringify({ all: true }),
      });
      await loadNotifications(member);
    } finally {
      button.disabled = false;
    }
  });
});

document.querySelectorAll("[data-edit-pet-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const member = readMember();
    const note = form.querySelector("[data-edit-pet-note]");
    const button = form.querySelector("button[type='submit']");
    if (!member) return;
    const values = Object.fromEntries(new FormData(form).entries());
    if (button) { button.disabled = true; button.textContent = "Saving profile..."; }
    if (note) note.textContent = "";
    try {
      const response = await fetch("/api/pets", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...values, dogId: member.dogId, memberId: member.id, memberToken: member.token }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "We could not update that profile.");
      activatePet(accountOwner, result.pet);
      renderPetProfile(result.pet, readMember());
      if (note) note.textContent = result.message;
      setTimeout(() => form.closest("[data-account-panel-content]")?.setAttribute("hidden", ""), 650);
    } catch (error) {
      if (note) note.textContent = error.message || "We could not update that profile right now.";
    } finally {
      if (button) { button.disabled = false; button.textContent = "Save profile"; }
    }
  });
});

document.querySelectorAll("[data-profile-photo-input]").forEach((input) => {
  input.addEventListener("change", async () => {
    const member = readMember();
    const file = input.files?.[0];
    const note = input.closest(".pet-profile-photo")?.querySelector("[data-profile-photo-note]");
    if (!member || !file) return;
    if (!file.type.startsWith("image/")) { if (note) note.textContent = "Choose a JPG, PNG, or WebP image."; return; }
    if (file.size > 20 * 1024 * 1024) { if (note) note.textContent = "Choose an image under 20 MB."; return; }
    if (note) note.textContent = "Uploading photo...";
    const formData = new FormData();
    formData.append("memberId", member.id);
    formData.append("memberToken", member.token);
    formData.append("dogId", member.dogId);
    formData.append("purpose", "profile");
    formData.append("file", file);
    try {
      const response = await fetch("/api/media", { method: "POST", body: formData });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "We could not upload that photo.");
      const pet = accountPetProfiles.find((item) => item.dogId === member.dogId) || { ...member };
      pet.profileMediaId = result.media?.id || pet.profileMediaId;
      activatePet(accountOwner, pet);
      await loadPrivateProfilePhoto(pet, readMember());
      if (note) note.textContent = "Profile photo saved.";
    } catch (error) {
      if (note) note.textContent = error.message || "We could not upload that photo right now.";
    } finally {
      input.value = "";
    }
  });
});

const applyMemberState = () => {
  const member = readMember();
  document.querySelectorAll("[data-profile-form]").forEach((form) => {
    const complete = form.closest(".profile-section")?.querySelector("[data-profile-complete]");
    const enrollLayout = form.closest(".profile-enroll-layout");
    if (!member) return;
    if (enrollLayout) enrollLayout.hidden = true;
    if (complete) complete.hidden = false;
    complete?.querySelectorAll("[data-profile-dog-name]").forEach((node) => {
      node.textContent = member.dogName;
    });
    complete?.querySelectorAll("[data-checkin-form]").forEach((checkinForm) => applyTrackerPrompt(checkinForm, member));
  });
  document.querySelectorAll("[data-community-gate]").forEach((gate) => {
    const enroll = gate.querySelector("[data-community-enroll]");
    const compose = gate.querySelector("[data-community-form]");
    if (enroll) enroll.hidden = Boolean(member);
    if (compose) compose.hidden = !member;
  });
  document.querySelectorAll("[data-circle-gate]").forEach((gate) => {
    const enroll = gate.querySelector("[data-circle-enroll]");
    const form = gate.querySelector("[data-circle-form]");
    const success = gate.querySelector("[data-circle-host-success]");
    if (enroll) enroll.hidden = Boolean(member);
    if (form) form.hidden = !member;
    if (success && !member) success.hidden = true;
  });
  document.querySelectorAll("[data-community-research-gate]").forEach((gate) => {
    const enroll = gate.querySelector("[data-community-research-enroll]");
    const form = gate.querySelector("[data-community-research-form]");
    if (enroll) enroll.hidden = Boolean(member);
    if (form) form.hidden = !member;
  });
  document.querySelectorAll("[data-care-chat-gate]").forEach((gate) => {
    const enroll = gate.querySelector("[data-care-chat-enroll]");
    const form = gate.querySelector("[data-care-chat-form]");
    if (enroll) enroll.hidden = Boolean(member);
    if (form) form.hidden = !member;
  });
  document.querySelectorAll("[data-meetup-gate]").forEach((gate) => {
    const enroll = gate.querySelector("[data-meetup-enroll]");
    const readiness = gate.querySelector("[data-meetup-readiness]");
    const content = gate.querySelector("[data-meetup-content]");
    if (enroll) enroll.hidden = Boolean(member);
    if (readiness) readiness.hidden = !member;
    if (content) content.hidden = true;
  });
  if (member) {
    loadAccountSnapshot(member);
    loadPetProfiles(member);
    loadCommunityResearch();
    loadCareChatHistory(member);
    if (member.membershipPlan && member.membershipPlan !== "free") loadMemories(member);
    loadNotifications(member);
    loadMeetups(member);
  }
  return member;
};

const meetupLabel = (value) => String(value || "").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const meetupRatingField = (label, name) => {
  const field = document.createElement("label");
  const caption = document.createElement("span");
  const select = document.createElement("select");
  caption.textContent = label;
  select.name = name;
  [5, 4, 3, 2, 1].forEach((value) => {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = `${value} / 5`;
    select.append(option);
  });
  field.append(caption, select);
  return field;
};

const renderMeetupMatches = (matches = []) => {
  const root = document.querySelector("[data-meetup-results]");
  if (!root) return;
  root.replaceChildren();
  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "meetup-empty";
    empty.innerHTML = "<h3>No local match yet.</h3><p>Your contact details are never shown. Try again as more nearby families join.</p>";
    root.append(empty);
    return;
  }
  matches.forEach((match) => {
    const card = document.createElement("article");
    card.className = "meetup-match-card";
    const reasons = Array.isArray(match.reasons) ? match.reasons : [];
    const score = document.createElement("div");
    score.className = "meetup-match-score";
    const scoreValue = document.createElement("strong");
    const scoreLabel = document.createElement("span");
    scoreValue.textContent = `${Math.max(0, Math.min(100, Number(match.score || 0)))}%`;
    scoreLabel.textContent = "fit";
    score.append(scoreValue, scoreLabel);

    const summary = document.createElement("div");
    const badge = document.createElement("span");
    const title = document.createElement("h3");
    const meta = document.createElement("p");
    const reasonList = document.createElement("ul");
    badge.className = "source-badge";
    badge.textContent = "Suggested match";
    title.textContent = `${match.petName || "A nearby pet"} & ${match.ownerFirstName || "their person"}`;
    meta.textContent = [match.breed, match.species && meetupLabel(match.species), match.city && `${match.city}, ${match.region || ""}`.replace(/,\s*$/, "")].filter(Boolean).join(" · ");
    reasons.forEach((reason) => {
      const item = document.createElement("li");
      item.textContent = String(reason || "");
      reasonList.append(item);
    });
    summary.append(badge, title, meta, reasonList);
    card.append(score, summary);
    if (!match.feedbackSubmitted) {
      const details = document.createElement("details");
      details.className = "meetup-feedback";
      const detailsSummary = document.createElement("summary");
      const form = document.createElement("form");
      const ratingGrid = document.createElement("div");
      const notesField = document.createElement("label");
      const notesCaption = document.createElement("span");
      const notes = document.createElement("textarea");
      const againField = document.createElement("label");
      const again = document.createElement("input");
      const againCaption = document.createElement("span");
      const button = document.createElement("button");
      const note = document.createElement("p");
      detailsSummary.textContent = "Share private feedback after meeting";
      form.dataset.meetupFeedback = "";
      form.dataset.matchId = String(match.id || "");
      ratingGrid.className = "meetup-rating-grid";
      ratingGrid.append(
        meetupRatingField("Pet comfort", "comfortRating"),
        meetupRatingField("Energy fit", "energyFitRating"),
        meetupRatingField("Owner fit", "ownerFitRating"),
        meetupRatingField("Safety", "safetyRating")
      );
      notesCaption.textContent = "One useful detail (optional)";
      notes.name = "notes";
      notes.maxLength = 600;
      notesField.append(notesCaption, notes);
      againField.className = "meetup-mixed";
      again.type = "checkbox";
      again.name = "meetAgain";
      againCaption.textContent = "We would meet again.";
      againField.append(again, againCaption);
      button.className = "button secondary";
      button.type = "submit";
      button.textContent = "Save private feedback";
      note.className = "form-note";
      note.dataset.meetupFeedbackNote = "";
      form.append(ratingGrid, notesField, againField, button, note);
      details.append(detailsSummary, form);
      card.append(details);
    }
    root.append(card);
  });
};

const applyMeetupProfile = (form, profile) => {
  if (!form || !profile) return;
  Object.entries(profile).forEach(([key, value]) => {
    const field = form.elements.namedItem(key);
    if (!field) return;
    if (field.type === "checkbox") field.checked = Boolean(value);
    else field.value = value ?? "";
  });
};

const loadMeetups = async (member = readMember()) => {
  const form = document.querySelector("[data-meetup-profile-form]");
  if (!member || !form) return;
  const gate = form.closest("[data-meetup-gate]");
  const readiness = gate?.querySelector("[data-meetup-readiness]");
  const content = gate?.querySelector("[data-meetup-content]");
  const note = form.querySelector("[data-meetup-note]");
  try {
    const response = await fetch(`/api/meetups?petId=${encodeURIComponent(member.dogId)}`, { headers: { accept: "application/json", ...memberHeaders(member) } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "We could not load meetup matching.");
    if (readiness) {
      readiness.hidden = Boolean(result.unlocked);
      const count = readiness.querySelector("[data-meetup-context-count]");
      const remaining = readiness.querySelector("[data-meetup-context-remaining]");
      if (count) count.textContent = String(Math.min(result.contextCount || 0, result.requiredContextCount || 3));
      if (remaining) remaining.textContent = String(Math.max(0, (result.requiredContextCount || 3) - (result.contextCount || 0)));
    }
    if (content) content.hidden = !result.unlocked;
    applyMeetupProfile(form, result.profile);
    renderMeetupMatches(result.matches || []);
  } catch (error) {
    if (note) note.textContent = error.message || "Meetup matching is unavailable right now.";
  }
};

document.querySelectorAll("[data-meetup-profile-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const member = readMember();
    const note = form.querySelector("[data-meetup-note]");
    const button = form.querySelector("button[type='submit']");
    if (!member) return;
    const values = Object.fromEntries(new FormData(form).entries());
    if (button) { button.disabled = true; button.textContent = "Saving..."; }
    if (note) note.textContent = "";
    try {
      const result = await requestJson("/api/meetups", { ...values, mixedSpeciesOk: Boolean(form.elements.mixedSpeciesOk?.checked), action: "profile", petId: member.dogId, memberId: member.id, memberToken: member.token });
      if (note) note.textContent = result.message;
      applyMeetupProfile(form, result.profile);
    } catch (error) {
      if (note) note.textContent = error.message || "We could not save matching preferences.";
    } finally {
      if (button) { button.disabled = false; button.textContent = "Save matching profile"; }
    }
  });
});

document.querySelectorAll("[data-meetup-find]").forEach((button) => {
  button.addEventListener("click", async () => {
    const member = readMember();
    const form = button.closest("[data-meetup-profile-form]");
    const note = form?.querySelector("[data-meetup-note]");
    if (!member || !form) return;
    button.disabled = true;
    button.textContent = "Looking for the best fit...";
    if (note) note.textContent = "";
    try {
      const result = await requestJson("/api/meetups", { action: "match", petId: member.dogId, memberId: member.id, memberToken: member.token });
      if (note) note.textContent = result.message;
      renderMeetupMatches(result.matches || []);
    } catch (error) {
      if (note) note.textContent = error.message || "We could not rank a match right now.";
    } finally {
      button.disabled = false;
      button.textContent = "Find my best match";
    }
  });
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-meetup-feedback]");
  if (!form) return;
  event.preventDefault();
  const member = readMember();
  const note = form.querySelector("[data-meetup-feedback-note]");
  const button = form.querySelector("button[type='submit']");
  if (!member) return;
  const values = Object.fromEntries(new FormData(form).entries());
  if (button) { button.disabled = true; button.textContent = "Saving..."; }
  try {
    const result = await requestJson("/api/meetups", { ...values, meetAgain: Boolean(form.elements.meetAgain?.checked), action: "feedback", matchId: form.dataset.matchId, petId: member.dogId, memberId: member.id, memberToken: member.token });
    if (note) note.textContent = result.message;
    await loadMeetups(member);
  } catch (error) {
    if (note) note.textContent = error.message || "We could not save that feedback.";
  } finally {
    if (button) { button.disabled = false; button.textContent = "Save private feedback"; }
  }
});

document.querySelectorAll("[data-profile-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const note = form.querySelector("[data-profile-note]");
    const button = form.querySelector("button[type='submit']");
    const values = Object.fromEntries(new FormData(form).entries());
    values.location = [values.city, values.region].filter(Boolean).join(", ");
    const payload = { ...values, consent: Boolean(form.querySelector("[name='consent']")?.checked) };

    if (button) {
      button.disabled = true;
      button.textContent = "Creating care account...";
    }
    if (note) note.textContent = "";
    try {
      const result = await requestJson("/api/enroll", payload);
      saveMember({ ...result.member, focus: values.focus, species: values.species });
      if (note) note.textContent = result.message;
      applyMemberState();
      loadCircles();
      const pendingLesson = localStorage.getItem(pendingLessonKey);
      if (pendingLesson) {
        localStorage.removeItem(pendingLessonKey);
        window.location.href = `/community/?topic=${encodeURIComponent(pendingLesson)}#ask`;
        return;
      }
      requestAnimationFrame(() => {
        form.closest(".profile-section")?.querySelector("[data-profile-complete]")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (error) {
      if (note) note.textContent = error.message || "We could not save that profile right now.";
      if (button) button.textContent = "Create my care account";
    } finally {
      if (button) button.disabled = false;
    }
  });
});

const publicLessonPage = document.querySelector("[data-public-lesson-page]");
if (publicLessonPage && !readMember()) {
  const lessonKey = "woafmeow-public-lessons-read-v1";
  const lessonSlug = publicLessonPage.dataset.publicLessonPage;
  let readLessons = [];
  try { readLessons = JSON.parse(localStorage.getItem(lessonKey) || "[]"); } catch { readLessons = []; }
  if (!readLessons.includes(lessonSlug) && readLessons.length >= 2) {
    publicLessonPage.innerHTML = `<section class="public-lesson-limit"><h1>Keep learning with your pet beside you.</h1><p>You have read two public lessons. Create one free pet account to continue and save lessons for that pet.</p><a class="button primary" href="/my-pet/#enroll">Create a free account</a><a class="button secondary" href="/community/">Back to public lessons</a></section>`;
  } else if (!readLessons.includes(lessonSlug)) {
    readLessons.push(lessonSlug);
    localStorage.setItem(lessonKey, JSON.stringify(readLessons));
  }
}

document.querySelectorAll("[data-add-pet-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const member = readMember();
    const note = form.querySelector("[data-add-pet-note]");
    const button = form.querySelector("button[type='submit']");
    if (!member) return;
    const values = Object.fromEntries(new FormData(form).entries());
    if (button) { button.disabled = true; button.textContent = "Adding pet..."; }
    if (note) note.textContent = "";
    try {
      const result = await requestJson("/api/pets", { ...values, memberId: member.id, memberToken: member.token });
      activatePet({}, result.pet);
      if (note) note.textContent = result.message;
      window.location.reload();
    } catch (error) {
      if (note) note.textContent = error.message || "We could not add that pet right now.";
    } finally {
      if (button) { button.disabled = false; button.textContent = "Add this pet"; }
    }
  });
});

document.querySelectorAll("[data-checkin-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const member = readMember();
    const note = form.querySelector("[data-checkin-note]");
    const button = form.querySelector("button[type='submit']");
    if (!member) {
      if (note) note.textContent = "Create your pet's profile before saving a check-in.";
      return;
    }
    const values = Object.fromEntries(new FormData(form).entries());
    if (button) {
      button.disabled = true;
      button.textContent = "Saving check-in...";
    }
    if (note) note.textContent = "";
    try {
      const result = await requestJson("/api/checkin", {
        ...values,
        prompt: form.dataset.trackerPrompt || trackerPromptFor(member, values.dayNumber),
        memberId: member.id,
        memberToken: member.token,
        dogId: member.dogId,
      });
      if (note) note.textContent = result.message;
      const glanceRoot = form.querySelector("[data-day-glance-result]");
      if (glanceRoot && result.glance) {
        glanceRoot.hidden = false;
        glanceRoot.replaceChildren();
        const title = document.createElement("h3");
        title.textContent = result.glance.headline;
        const reflection = document.createElement("p");
        reflection.textContent = result.glance.reflection;
        const share = document.createElement("button");
        share.type = "button";
        share.className = "button secondary";
        share.textContent = "Share this glance";
        share.addEventListener("click", async () => {
          const text = result.glance.shareText;
          if (navigator.share) await navigator.share({ title: result.glance.headline, text }).catch(() => {});
          else await navigator.clipboard?.writeText(text);
          share.textContent = navigator.share ? "Shared" : "Copied";
        });
        glanceRoot.append(title, reflection, share);
      }
      form.reset();
      applyTrackerPrompt(form, member);
      loadAccountSnapshot(member);
      loadNotifications(member);
    } catch (error) {
      if (note) note.textContent = error.message || "We could not save that check-in right now.";
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "Save today's glance";
      }
    }
  });
});

document.querySelectorAll("[data-tracker-day]").forEach((select) => {
  select.addEventListener("change", () => {
    const form = select.closest("[data-checkin-form]");
    if (form) applyTrackerPrompt(form, readMember());
  });
});

document.addEventListener("click", async (event) => {
  const buildButton = event.target.closest("[data-build-vet-summary]");
  if (buildButton) {
    const member = readMember();
    const tool = buildButton.closest("[data-vet-summary-tool]");
    const panel = tool?.querySelector("[data-vet-summary-panel]");
    if (!member || !panel) return;
    buildButton.disabled = true;
    buildButton.textContent = "Loading record...";
    try {
      const result = await loadCareRecord(member);
      panel.hidden = false;
      renderVetSummary(panel, member, Array.isArray(result.entries) ? result.entries : []);
    } catch (error) {
      panel.hidden = false;
      panel.replaceChildren();
      const message = document.createElement("p");
      message.textContent = error.message || "We could not load the care record right now.";
      panel.append(message);
    } finally {
      buildButton.disabled = false;
      buildButton.textContent = "See my saved observations";
    }
  }
});

const createCommunityPost = (post) => {
  const article = document.createElement("article");
  article.className = "community-post";
  const topic = document.createElement("span");
  topic.className = "community-topic";
  topic.textContent = post.topic;
  const heading = document.createElement("h3");
  heading.textContent = post.groupTitle || `${post.dogName}'s family`;
  const body = document.createElement("p");
  body.textContent = post.body;
  const meta = document.createElement("span");
  meta.className = "community-post-meta";
  const created = new Date(post.createdAt);
  const dateText = Number.isNaN(created.getTime()) ? "Shared by an owner" : `Shared ${created.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  meta.textContent = post.groupTitle ? `${post.dogName}'s family · ${dateText}` : dateText;
  article.append(topic, heading, body, meta);

  const media = Array.isArray(post.media) ? post.media : [];
  if (media.length) {
    const mediaList = document.createElement("div");
    mediaList.className = "community-post-media";
    media.forEach((asset) => {
      if (asset.mediaKind === "image") {
        const image = document.createElement("img");
        image.src = asset.url;
        image.alt = "Care Circle member update";
        image.loading = "lazy";
        mediaList.append(image);
      } else if (asset.mediaKind === "video") {
        const video = document.createElement("video");
        video.src = asset.url;
        video.controls = true;
        video.preload = "metadata";
        mediaList.append(video);
      } else if (asset.mediaKind === "audio") {
        const audio = document.createElement("audio");
        audio.src = asset.url;
        audio.controls = true;
        audio.preload = "metadata";
        mediaList.append(audio);
      }
    });
    article.append(mediaList);
  }

  const actions = document.createElement("div");
  actions.className = "community-post-actions";
  if (post.conversationId) {
    const lesson = document.createElement("button");
    lesson.type = "button";
    lesson.dataset.publicLesson = post.id;
    lesson.className = "community-read-lesson";
    lesson.textContent = "Read lesson";
    actions.append(lesson);
  }
  const helpful = document.createElement("button");
  helpful.type = "button";
  helpful.dataset.communityAction = "helpful";
  helpful.dataset.postId = post.id;
  helpful.className = post.viewerHelpful ? "is-active" : "";
  helpful.textContent = `Helpful ${Number(post.helpfulCount || 0)}`;
  const save = document.createElement("button");
  save.type = "button";
  save.dataset.communityAction = "save";
  save.dataset.postId = post.id;
  save.className = post.viewerSaved ? "is-active" : "";
  save.textContent = post.viewerSaved ? "Saved" : `Save ${Number(post.saveCount || 0)}`;
  const share = document.createElement("button");
  share.type = "button";
  share.dataset.communityShare = post.id;
  share.dataset.shareTitle = heading.textContent;
  share.textContent = "Share";
  actions.append(helpful, save, share);
  article.append(actions);

  const replies = Array.isArray(post.replies) ? post.replies : [];
  if (replies.length) {
    const replyList = document.createElement("div");
    replyList.className = "community-replies";
    const replyHeading = document.createElement("h4");
    replyHeading.textContent = replies.length === 1 ? "1 owner reply" : `${replies.length} owner replies`;
    replyList.append(replyHeading);
    replies.forEach((reply) => {
      const replyCard = document.createElement("div");
      replyCard.className = "community-reply";
      const replyName = document.createElement("strong");
      replyName.textContent = `${reply.dogName}'s family`;
      const replyBody = document.createElement("p");
      replyBody.textContent = reply.body;
      replyCard.append(replyName, replyBody);
      replyList.append(replyCard);
    });
    article.append(replyList);
  }

  if (readMember()) {
    const replyForm = document.createElement("form");
    replyForm.className = "community-reply-form";
    replyForm.dataset.communityReply = "";
    replyForm.dataset.postId = post.id;
    const replyLabel = document.createElement("label");
    const replyText = document.createElement("span");
    replyText.textContent = "Add a thoughtful reply";
    const replyInput = document.createElement("textarea");
    replyInput.name = "body";
    replyInput.required = true;
    replyInput.maxLength = 800;
    replyInput.placeholder = "Share what helped or the question you would carry forward.";
    replyLabel.append(replyText, replyInput);
    const replyButton = document.createElement("button");
    replyButton.className = "button secondary";
    replyButton.type = "submit";
    replyButton.textContent = "Reply";
    const replyNote = document.createElement("p");
    replyNote.className = "form-note";
    replyNote.dataset.communityReplyNote = "";
    replyForm.append(replyLabel, replyButton, replyNote);
    article.append(replyForm);
  }
  return article;
};

const communityStarters = [
  {
    topic: "Movement",
    title: "The first steps after a nap",
    body: "What one family records before a mobility visit.",
    prompt: "My older pet is slower after resting. Help me understand exactly what to watch, record, and discuss with my veterinarian.",
    image: "/media/real/photo-03.jpg",
    href: "/community/lessons/slower-after-rest/",
  },
  {
    topic: "Night routine",
    title: "When the house stops sleeping",
    body: "A simple timeline for pacing, wake-ups, and settling.",
    prompt: "My older pet is waking or pacing at night. Help me build a useful timeline and understand which changes need veterinary attention.",
    image: "/media/real/photo-21.jpg",
    href: "/community/lessons/restless-at-night/",
  },
  {
    topic: "Eating",
    title: "When dinner looks different",
    body: "Separate one missed meal from a pattern worth calling about.",
    prompt: "My older pet is eating less. Help me compare the pattern with drinking, weight, dental comfort, nausea, medicine, and energy.",
    image: "/media/real/photo-08.jpg",
    href: "/community/lessons/changes-in-appetite/",
  },
  {
    topic: "Senior cats",
    title: "The jump they stopped making",
    body: "What changed height, grooming, and litter habits can reveal.",
    prompt: "My older cat has stopped jumping to a favorite place. Help me understand what else to watch and what to ask my veterinarian.",
    image: "/media/real/photo-55.jpg",
    href: "/community/lessons/senior-cat-joint-changes/",
  },
  {
    topic: "Quality of life",
    title: "Preparing before a crisis",
    body: "Comfort, function, joy, and the questions families can prepare.",
    prompt: "I want to prepare for end-of-life decisions before a crisis. Help me understand comfort, function, joy, recovery, and questions for my veterinary team.",
    image: "/media/real/photo-60.jpg",
    href: "/preparing-for-pet-loss/",
  },
];

const createCommunityStarter = (starter) => {
  const article = document.createElement("article");
  article.className = "community-post community-starter";
  if (starter.image) {
    const image = document.createElement("img");
    image.className = "community-starter-image";
    image.src = starter.image;
    image.alt = "";
    image.setAttribute("aria-hidden", "true");
    image.loading = "lazy";
    article.append(image);
  }
  const topic = document.createElement("span");
  topic.className = "community-topic";
  topic.textContent = `Suggested · ${starter.topic}`;
  const heading = document.createElement("h3");
  heading.textContent = starter.title;
  const body = document.createElement("p");
  body.textContent = starter.body;
  const link = document.createElement("a");
  link.className = "text-link";
  link.href = starter.href;
  link.textContent = "Open lesson";
  article.append(topic, heading, body, link);
  return article;
};

const renderCommunityStarters = (list, empty, count, reconnecting = false) => {
  list.replaceChildren(...communityStarters.map(createCommunityStarter));
  if (empty) empty.hidden = true;
  if (count) count.textContent = reconnecting ? "Suggested topics" : "Five starting points";
};

const focusLabels = {
  mobility: "mobility and movement",
  sleep: "sleep and settling",
  appetite: "appetite and daily routine",
  comfort: "comfort at home",
  recovery: "recovery and healing",
  "quality-of-life": "good days and quality of life",
  "daily-routine": "daily routines",
  "vet-visit": "veterinary conversations",
};

const circleSpeciesLabels = {
  dog: "Older dogs",
  cat: "Older cats",
  all: "Older dogs and cats",
};

const createCircleCard = (group, member) => {
  const article = document.createElement("article");
  article.className = "circle-group-card";
  const focus = document.createElement("span");
  focus.className = "community-topic";
  focus.textContent = `${circleSpeciesLabels[group.species] || circleSpeciesLabels.all} · ${focusLabels[group.focus] || group.focus}`;
  const title = document.createElement("h3");
  title.textContent = group.title;
  const description = document.createElement("p");
  description.textContent = group.description;
  const meta = document.createElement("p");
  meta.className = "circle-group-meta";
  const count = Number(group.memberCount || 0);
  meta.textContent = `Hosted by ${group.hostDogName}'s family · ${count} ${count === 1 ? "member" : "members"} · ${group.cadence.replace("-", " ")}`;
  article.append(focus, title, description, meta);

  if (!member) {
    const enroll = document.createElement("a");
    enroll.className = "button secondary";
    enroll.href = "/my-pet/";
    enroll.textContent = "Enroll to Join";
    article.append(enroll);
  } else if (group.isHost) {
    const host = document.createElement("span");
    host.className = "circle-member-status";
    host.textContent = "You host this Circle";
    article.append(host);
  } else if (group.isJoined) {
    const joined = document.createElement("span");
    joined.className = "circle-member-status";
    joined.textContent = "You are in this Circle";
    article.append(joined);
  } else {
    const join = document.createElement("button");
    join.className = "button secondary";
    join.type = "button";
    join.dataset.circleJoin = group.id;
    join.textContent = "Join This Circle";
    article.append(join);
  }
  return article;
};

const refreshCommunityGroupChoices = (groups, member) => {
  document.querySelectorAll("[data-community-group]").forEach((select) => {
    const selected = select.value;
    select.replaceChildren();
    const communityOption = document.createElement("option");
    communityOption.value = "";
    communityOption.textContent = "Care Circle community";
    select.append(communityOption);
    groups.filter((group) => group.isJoined || group.isHost).forEach((group) => {
      const option = document.createElement("option");
      option.value = group.id;
      option.textContent = group.title;
      select.append(option);
    });
    select.value = [...select.options].some((option) => option.value === selected) ? selected : "";
    select.disabled = !member;
  });
};

const loadCircles = async () => {
  const list = document.querySelector("[data-circle-list]");
  const empty = document.querySelector("[data-circle-empty]");
  const count = document.querySelector("[data-circle-count]");
  const matchCopy = document.querySelector("[data-circle-match-copy]");
  const pendingList = document.querySelector("[data-circle-pending]");
  const hostSuccess = document.querySelector("[data-circle-host-success]");
  if (!list) return;
  const member = readMember();
  try {
    const response = await fetch("/api/circles", { headers: { accept: "application/json", ...memberHeaders(member) } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "We could not load Care Circles right now.");
    const groups = Array.isArray(result.groups) ? result.groups : [];
    const pendingGroups = Array.isArray(result.pendingGroups) ? result.pendingGroups : [];
    list.replaceChildren(...groups.map((group) => createCircleCard(group, member)));
    if (empty) empty.hidden = groups.length > 0;
    if (count) count.textContent = groups.length === 1 ? "1 open Circle" : `${groups.length} open Circles`;
    refreshCommunityGroupChoices(groups, member);
    if (pendingList) {
      pendingList.replaceChildren();
      pendingList.hidden = pendingGroups.length === 0;
      if (pendingGroups.length) {
        const heading = document.createElement("h3");
        heading.textContent = "Your Circles in setup";
        const intro = document.createElement("p");
        intro.textContent = "These invitations are saved and waiting for a quick clarity and safety review before other owners can join.";
        const cards = document.createElement("div");
        cards.className = "circle-pending-cards";
        pendingGroups.forEach((group) => {
          const card = document.createElement("article");
          card.className = "circle-pending-card";
          const title = document.createElement("strong");
          title.textContent = group.title;
          const detail = document.createElement("span");
          detail.textContent = `${circleSpeciesLabels[group.species] || circleSpeciesLabels.all} · ${focusLabels[group.focus] || group.focus}`;
          card.append(title, detail);
          cards.append(card);
        });
        pendingList.append(heading, intro, cards);
      }
    }
    if (hostSuccess && pendingGroups.length) {
      hostSuccess.hidden = false;
      hostSuccess.querySelector("[data-circle-host-title]").textContent = pendingGroups[0].title;
      hostSuccess.querySelector("[data-circle-host-message]").textContent = "Your invitation is saved. It will open once the purpose is clear and the space is ready to welcome other owners.";
    }
    if (matchCopy && member) {
      const matching = groups.filter((group) => group.focus === member.focus && (!group.species || group.species === "all" || group.species === member.species));
      matchCopy.textContent = matching.length
        ? `We found ${matching.length === 1 ? "a Circle" : `${matching.length} Circles`} around ${focusLabels[member.focus] || "the concern you chose"}.`
        : `When a Circle forms around ${focusLabels[member.focus] || "the concern you chose"}, it will appear here.`;
    }
  } catch (error) {
    if (empty) {
      empty.hidden = false;
      empty.querySelector("p").textContent = error.message || "We could not load Care Circles right now.";
    }
    if (count) count.textContent = "Unavailable";
  }
};

const loadCommunity = async () => {
  const list = document.querySelector("[data-community-list]");
  const empty = document.querySelector("[data-community-empty]");
  const count = document.querySelector("[data-community-count]");
  if (!list) return;
  try {
    const response = await fetch("/api/community", { headers: { accept: "application/json", ...memberHeaders(readMember()) } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "We could not load Care Circle right now.");
    const posts = Array.isArray(result.posts) ? result.posts : [];
    if (posts.length) {
      list.replaceChildren(...posts.map(createCommunityPost));
      if (empty) empty.hidden = true;
      if (count) count.textContent = posts.length === 1 ? "1 conversation" : `${posts.length} conversations`;
    } else {
      renderCommunityStarters(list, empty, count);
    }
  } catch (error) {
    renderCommunityStarters(list, empty, count, true);
  }
};

const renderResearchResult = (result, { historical = false } = {}) => {
  const root = document.querySelector("[data-community-research-result]");
  if (!root || !result?.brief) return;
  root.hidden = false;
  root.replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = historical ? `Saved brief: ${result.query}` : result.brief.title;
  const summary = document.createElement("p");
  summary.textContent = historical
    ? "This brief is saved in your account. Public-source access is still being configured."
    : result.sourceStatus || "Your research brief is saved in your account.";
  const list = document.createElement("ul");
  (result.brief.prompts || []).forEach((prompt) => {
    const item = document.createElement("li");
    item.textContent = prompt;
    list.append(item);
  });
  root.append(heading, summary, list);
  if (result.quota) {
    const quota = document.createElement("span");
    quota.className = "research-quota";
    quota.textContent = `${result.quota.remaining} of ${result.quota.limit} free searches left today`;
    root.append(quota);
  }
};

const loadCommunityResearch = async () => {
  const member = readMember();
  if (!member || !document.querySelector("[data-community-research-gate]")) return;
  try {
    const response = await fetch(`/api/community-research?dogId=${encodeURIComponent(member.dogId)}`, {
      headers: { accept: "application/json", ...memberHeaders(member) },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(result.history) || !result.history.length) return;
    renderResearchResult({ ...result.history[0], quota: result.quota }, { historical: true });
  } catch {
    // The account and Circle remain useful even when a research history cannot load.
  }
};

document.querySelectorAll("[data-community-research-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const member = readMember();
    const note = form.querySelector("[data-community-research-note]");
    const button = form.querySelector("button[type='submit']");
    if (!member) {
      if (note) note.textContent = "Enroll a pet before saving a research brief.";
      return;
    }
    const values = Object.fromEntries(new FormData(form).entries());
    if (button) {
      button.disabled = true;
      button.textContent = "Saving brief...";
    }
    if (note) note.textContent = "";
    try {
      const result = await requestJson(
        "/api/community-research",
        { ...values, dogId: member.dogId },
        memberHeaders(member)
      );
      if (note) note.textContent = result.message;
      renderResearchResult(result);
      form.reset();
    } catch (error) {
      if (note) note.textContent = error.message || "We could not save that research request right now.";
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "Build research brief";
      }
    }
  });
});

const showCommunityMediaChoices = (input) => {
  const list = input.closest("form")?.querySelector("[data-community-media-list]");
  if (!list) return;
  const files = [...(input.files || [])];
  list.replaceChildren();
  if (!files.length) return;
  const message = document.createElement("p");
  message.textContent = files.length > 3 ? "Choose up to 3 attachments." : files.map((file) => file.name).join(" · ");
  list.append(message);
};

const uploadCommunityMedia = async (files, member) => {
  const uploaded = [];
  for (const file of files) {
    const formData = new FormData();
    formData.append("memberId", member.id);
    formData.append("memberToken", member.token);
    formData.append("dogId", member.dogId);
    formData.append("file", file);
    const response = await fetch("/api/media", { method: "POST", body: formData });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "We could not upload that attachment right now.");
    uploaded.push(result.media.id);
  }
  return uploaded;
};

document.querySelectorAll("[data-community-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const member = readMember();
    const note = form.querySelector("[data-community-note]");
    const button = form.querySelector("button[type='submit']");
    if (!member) {
      if (note) note.textContent = "Enroll your pet before starting a conversation.";
      return;
    }
    const values = Object.fromEntries(new FormData(form).entries());
    const mediaInput = form.querySelector("[data-community-media]");
    const files = [...(mediaInput?.files || [])];
    if (files.length > 3) {
      if (note) note.textContent = "Choose up to 3 attachments for one update.";
      return;
    }
    if (button) {
      button.disabled = true;
      button.textContent = files.length ? "Uploading attachment..." : "Sending for review...";
    }
    if (note) note.textContent = "";
    try {
      const mediaIds = files.length ? await uploadCommunityMedia(files, member) : [];
      if (button && mediaIds.length) button.textContent = "Sending for review...";
      const result = await requestJson("/api/community", { ...values, mediaIds, kind: "post", memberId: member.id, memberToken: member.token, dogId: member.dogId });
      if (note) note.textContent = result.message;
      form.reset();
      form.querySelector("[data-community-media-list]")?.replaceChildren();
    } catch (error) {
      if (note) note.textContent = error.message || "We could not save that post right now.";
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "Send for review";
      }
    }
  });
});

document.querySelectorAll("[data-community-media]").forEach((input) => {
  input.addEventListener("change", () => showCommunityMediaChoices(input));
});

document.querySelectorAll("[data-circle-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const member = readMember();
    const note = form.querySelector("[data-circle-note]");
    const button = form.querySelector("button[type='submit']");
    if (!member) {
      if (note) note.textContent = "Enroll your pet before hosting a Care Circle.";
      return;
    }
    const values = Object.fromEntries(new FormData(form).entries());
    if (button) {
      button.disabled = true;
      button.textContent = "Saving your Circle...";
    }
    if (note) note.textContent = "";
    try {
      const result = await requestJson("/api/circles", { ...values, kind: "create", memberId: member.id, memberToken: member.token, dogId: member.dogId });
      if (note) note.textContent = result.message;
      const success = form.closest("[data-circle-gate]")?.querySelector("[data-circle-host-success]");
      if (success) {
        success.hidden = false;
        success.querySelector("[data-circle-host-title]").textContent = result.group?.title || values.title;
        success.querySelector("[data-circle-host-message]").textContent = result.message;
      }
      form.reset();
      await loadCircles();
    } catch (error) {
      if (note) note.textContent = error.message || "We could not create that Care Circle right now.";
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "Submit Circle";
      }
    }
  });
});

document.querySelectorAll("[data-provider-inquiry-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const note = form.querySelector("[data-provider-inquiry-note]");
    const button = form.querySelector("button[type='submit']");
    const values = Object.fromEntries(new FormData(form).entries());
    const payload = { ...values, consent: Boolean(form.querySelector("[name='consent']")?.checked) };
    if (button) {
      button.disabled = true;
      button.textContent = "Saving request...";
    }
    if (note) note.textContent = "";
    try {
      const result = await requestJson("/api/provider-inquiry", payload);
      if (note) note.textContent = result.message;
      form.reset();
      if (button) button.textContent = "Listing request received";
    } catch (error) {
      if (note) note.textContent = error.message || "We could not save that listing request right now.";
      if (button) button.textContent = "Send listing request";
    } finally {
      if (button) button.disabled = false;
    }
  });
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-circle-join]");
  if (!button) return;
  const member = readMember();
  if (!member) return;
  button.disabled = true;
  const original = button.textContent;
  button.textContent = "Joining...";
  try {
    await requestJson("/api/circles", { kind: "join", groupId: button.dataset.circleJoin, memberId: member.id, memberToken: member.token, dogId: member.dogId });
    await loadCircles();
  } catch {
    button.disabled = false;
    button.textContent = original;
  }
});

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.matches("[data-community-reply]")) return;
  event.preventDefault();
  const member = readMember();
  const note = form.querySelector("[data-community-reply-note]");
  const button = form.querySelector("button[type='submit']");
  if (!member) {
    if (note) note.textContent = "Enroll your pet before replying in Care Circle.";
    return;
  }
  const values = Object.fromEntries(new FormData(form).entries());
  if (button) {
    button.disabled = true;
    button.textContent = "Replying...";
  }
  if (note) note.textContent = "";
  try {
    const result = await requestJson("/api/community", { ...values, kind: "reply", postId: form.dataset.postId, memberId: member.id, memberToken: member.token, dogId: member.dogId });
    if (note) note.textContent = result.message;
    form.reset();
    await loadCommunity();
  } catch (error) {
    if (note) note.textContent = error.message || "We could not save that reply right now.";
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Reply";
    }
  }
});

document.addEventListener("click", (event) => {
  const close = event.target.closest("[data-account-close]");
  if (close) {
    close.closest("[data-account-panel-content]")?.setAttribute("hidden", "");
    document.querySelectorAll("[data-account-panel]").forEach((button) => button.classList.remove("is-active"));
    return;
  }
  const trigger = event.target.closest("[data-account-panel]");
  if (!trigger) return;
  const name = trigger.dataset.accountPanel;
  document.querySelectorAll("[data-account-panel]").forEach((button) => button.classList.toggle("is-active", button === trigger));
  document.querySelectorAll("[data-account-panel-content]").forEach((panel) => {
    panel.hidden = panel.dataset.accountPanelContent !== name;
  });
  document.querySelector(`[data-account-panel-content="${name}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

const openRequestedAccountPanel = () => {
  const requestedAccountPanel = new URLSearchParams(window.location.search).get("panel") || window.location.hash.replace("#", "");
  if (["add-pet", "edit-profile", "memories", "observe", "record", "ask", "notifications"].includes(requestedAccountPanel)) {
    window.setTimeout(() => document.querySelector(`[data-account-panel="${requestedAccountPanel}"]`)?.click(), 100);
  }
};
openRequestedAccountPanel();
window.addEventListener("hashchange", openRequestedAccountPanel);

const renderCareChatHistory = (items) => {
  document.querySelectorAll("[data-chat-history]").forEach((root) => {
    root.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("span");
      empty.textContent = "Your saved questions appear here.";
      root.append(empty);
      return;
    }
    items.forEach((item) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "knowledge-book-entry";
      row.dataset.loadChat = item.id;
      const title = document.createElement("strong");
      title.textContent = item.title;
      const meta = document.createElement("span");
      meta.textContent = `${item.topic} lesson · ${item.privacy}`;
      row.append(title, meta);
      root.append(row);
    });
  });
};

const loadCareChatHistory = async (member) => {
  if (!member || !document.querySelector("[data-chat-history]")) return;
  try {
    const response = await fetch("/api/care-chat", { headers: { accept: "application/json", ...memberHeaders(member) } });
    const result = await response.json().catch(() => ({}));
    if (response.ok) renderCareChatHistory(Array.isArray(result.conversations) ? result.conversations : []);
  } catch {
    renderCareChatHistory([]);
  }
};

const addChatBubble = (text, role) => {
  const thread = document.querySelector("[data-chat-thread]");
  if (!thread) return null;
  const bubble = document.createElement("article");
  bubble.className = `care-chat-bubble care-chat-bubble--${role}`;
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  bubble.append(paragraph);
  thread.append(bubble);
  return bubble;
};

const makeCareElement = (tag, className = "", text = "") => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
};

const renderCareIntake = (result, member, originForm) => {
  const thread = document.querySelector("[data-chat-thread]");
  const intake = result?.intake;
  if (!thread || !intake) return;
  originForm.hidden = true;
  const questions = Array.isArray(intake.questions) ? intake.questions : [];
  const context = {};
  let questionIndex = 0;
  addChatBubble(intake.intro || "I need a few details so this lesson fits your pet.", "assistant");
  const followup = makeCareElement("article", "care-chat-followup");
  thread.append(followup);

  const buildLesson = async () => {
    thread.append(followup);
    followup.replaceChildren(makeCareElement("p", "care-chat-thinking", "Building a chapter around what you shared..."));
    try {
      const lesson = await requestJson("/api/care-chat", {
        stage: "lesson",
        question: result.question,
        privacy: result.privacy,
        context,
        memberId: member.id,
        memberToken: member.token,
        dogId: member.dogId,
      });
      followup.remove();
      renderRichCareAnswer(lesson);
      originForm.reset();
      originForm.querySelector("[name='privacy'][value='public']").checked = true;
      loadCareChatHistory(member);
    } catch (error) {
      followup.replaceChildren(makeCareElement("p", "form-note", error.message || "We could not build that lesson right now."));
      const retry = makeCareElement("button", "button secondary", "Try again");
      retry.type = "button";
      retry.addEventListener("click", buildLesson);
      followup.append(retry);
    }
  };

  const renderQuestion = () => {
    thread.append(followup);
    const question = questions[questionIndex];
    if (!question) {
      buildLesson();
      return;
    }
    followup.replaceChildren();
    const progress = makeCareElement("span", "care-chat-progress", `Quick follow-up · ${questionIndex + 1} of ${questions.length}`);
    const prompt = makeCareElement("h3", "", question.label);
    followup.append(progress, prompt);
    if (question.type === "select") {
      const replies = makeCareElement("div", "care-chat-quick-replies");
      (question.options || []).forEach(([value, label]) => {
        const choice = makeCareElement("button", "", label);
        choice.type = "button";
        choice.addEventListener("click", () => {
          context[question.name] = value;
          addChatBubble(label, "owner");
          questionIndex += 1;
          renderQuestion();
        });
        replies.append(choice);
      });
      followup.append(replies);
    } else {
      const answerForm = makeCareElement("form", "care-chat-reply-form");
      const input = document.createElement("textarea");
      input.name = question.name;
      input.rows = 2;
      input.placeholder = question.optional ? "Add what matters, or skip." : "Type a short answer.";
      const actions = makeCareElement("div", "care-chat-reply-actions");
      const send = makeCareElement("button", "button primary", "Continue");
      send.type = "submit";
      actions.append(send);
      if (question.optional) {
        const skip = makeCareElement("button", "button secondary", "Skip");
        skip.type = "button";
        skip.addEventListener("click", () => {
          context[question.name] = "";
          questionIndex += 1;
          renderQuestion();
        });
        actions.append(skip);
      }
      answerForm.append(input, actions);
      answerForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const value = input.value.trim();
        if (!value && !question.optional) {
          input.focus();
          return;
        }
        context[question.name] = value;
        if (value) addChatBubble(value, "owner");
        questionIndex += 1;
        renderQuestion();
      });
      followup.append(answerForm);
      input.focus();
    }
    followup.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  renderQuestion();
};

const renderRichCareAnswer = (result) => {
  const thread = document.querySelector("[data-chat-thread]");
  const answer = result?.answer;
  if (!thread || !answer) return;
  const shell = thread.closest(".care-assistant-shell");
  shell?.classList.add("has-open-lesson");

  const card = makeCareElement("article", `care-lesson care-course${answer.topic === "urgent" ? " is-urgent" : ""}`);
  const courseLayout = makeCareElement("div", "care-course-layout");
  const outline = makeCareElement("aside", "care-course-outline");
  const outlineHead = makeCareElement("div", "care-course-outline-head");
  outlineHead.append(
    makeCareElement("span", "lesson-kicker", answer.bookTitle || "Care knowledge book"),
    makeCareElement("strong", "", answer.title),
  );
  const outlineNav = makeCareElement("nav", "care-course-nav");
  outlineNav.setAttribute("aria-label", "Lesson chapters");
  const introLink = makeCareElement("button", "is-active", "Start here");
  introLink.type = "button";
  introLink.dataset.lessonTarget = "lesson-overview";
  outlineNav.append(introLink);
  (answer.chapters || []).forEach((chapter) => {
    const button = makeCareElement("button", "", chapter.title);
    button.type = "button";
    button.dataset.lessonTarget = `lesson-chapter-${chapter.number}`;
    outlineNav.append(button);
  });
  const finishLink = makeCareElement("button", "", "Sources & next steps");
  finishLink.type = "button";
  finishLink.dataset.lessonTarget = "lesson-finish";
  outlineNav.append(finishLink);
  const askAgain = makeCareElement("button", "care-course-ask-again", "Ask another question");
  askAgain.type = "button";
  askAgain.addEventListener("click", () => {
    const form = document.querySelector("[data-care-chat-form]");
    form?.removeAttribute("hidden");
    form?.querySelector("[name='question']")?.focus();
    form?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  outline.append(outlineHead, outlineNav, askAgain);

  const reader = makeCareElement("div", "care-course-reader");
  const overviewPage = makeCareElement("section", "care-course-page is-active");
  overviewPage.dataset.coursePage = "lesson-overview";
  const cover = makeCareElement("header", "care-lesson-cover");
  const coverTop = makeCareElement("div", "care-lesson-cover-top");
  coverTop.append(
    makeCareElement("span", "lesson-kicker", answer.topic === "urgent" ? "Urgent next step" : "Built for this pet"),
    makeCareElement("span", "lesson-topic", answer.topic || "care"),
  );
  cover.append(coverTop, makeCareElement("h3", "", answer.title));
  if (answer.petContext) cover.append(makeCareElement("p", "care-lesson-pet", answer.petContext));
  cover.append(makeCareElement("p", "care-lesson-summary", answer.summary));
  if (result.question) {
    const question = makeCareElement("blockquote", "care-lesson-question");
    question.append(makeCareElement("span", "", "Question"), makeCareElement("p", "", result.question));
    cover.append(question);
  }
  overviewPage.append(cover);

  if (Array.isArray(answer.profileFacts) && answer.profileFacts.length) {
    const profile = makeCareElement("section", "care-lesson-profile");
    const profileHeading = makeCareElement("div", "care-lesson-profile-heading");
    profileHeading.append(makeCareElement("span", "lesson-kicker", "Context used"), makeCareElement("h4", "", "The care profile behind this lesson"));
    if (answer.evidenceNote) profileHeading.append(makeCareElement("p", "", answer.evidenceNote));
    const facts = makeCareElement("dl", "care-lesson-profile-facts");
    answer.profileFacts.forEach(([label, value]) => {
      const item = document.createElement("div");
      item.append(makeCareElement("dt", "", label), makeCareElement("dd", "", value));
      facts.append(item);
    });
    profile.append(profileHeading, facts);
    overviewPage.append(profile);
  }

  if (Array.isArray(answer.pattern) && answer.pattern.length) {
    const figure = makeCareElement("figure", "care-pattern-figure");
    const caption = makeCareElement("figcaption");
    caption.append(makeCareElement("strong", "", "Your observation map"), makeCareElement("span", "", "This organizes what you reported. It is not a medical score."));
    const rows = makeCareElement("div", "care-pattern-rows");
    answer.pattern.forEach((point) => {
      const row = makeCareElement("div", "care-pattern-row");
      const meta = makeCareElement("div");
      meta.append(makeCareElement("strong", "", point.label), makeCareElement("span", "", point.text));
      const track = makeCareElement("div", "care-pattern-track");
      const fill = makeCareElement("span", "care-pattern-fill");
      fill.style.width = `${Math.max(8, Math.min(100, Number(point.value || 0)))}%`;
      track.append(fill);
      row.append(meta, track);
      rows.append(row);
    });
    figure.append(caption, rows);
    overviewPage.append(figure);
  }
  reader.append(overviewPage);

  (answer.chapters || []).forEach((chapter) => {
    const section = makeCareElement("section", "care-chapter care-course-page");
    section.id = `lesson-chapter-${chapter.number}`;
    section.dataset.coursePage = `lesson-chapter-${chapter.number}`;
    const media = makeCareElement("figure", "care-chapter-media");
    const image = document.createElement("img");
    image.src = chapter.image;
    image.alt = `${chapter.title} care example`;
    image.loading = "lazy";
    media.append(image, makeCareElement("figcaption", "", `Figure ${chapter.number}. A real-life care moment related to this chapter.`));
    const copy = makeCareElement("div", "care-chapter-copy");
    copy.append(makeCareElement("span", "lesson-kicker", `Chapter ${chapter.number}`), makeCareElement("h4", "", chapter.title));
    (chapter.paragraphs || []).forEach((paragraph) => copy.append(makeCareElement("p", "", paragraph)));
    if (Array.isArray(chapter.bullets) && chapter.bullets.length) {
      const list = document.createElement("ul");
      chapter.bullets.forEach((value) => list.append(makeCareElement("li", "", value)));
      copy.append(list);
    }
    if (Array.isArray(chapter.table) && chapter.table.length) {
      const table = makeCareElement("dl", "care-chapter-table");
      chapter.table.forEach(([label, value]) => {
        const row = document.createElement("div");
        row.append(makeCareElement("dt", "", label), makeCareElement("dd", "", value));
        table.append(row);
      });
      copy.append(table);
    }
    if (chapter.marginNote) {
      const note = makeCareElement("aside", "care-chapter-note");
      note.append(makeCareElement("span", "lesson-kicker", "For this pet"), makeCareElement("p", "", chapter.marginNote));
      copy.append(note);
    }
    const chapterQuiz = (answer.quiz || []).find((item) => Number(item.chapter) === Number(chapter.number));
    if (chapterQuiz) {
      const check = makeCareElement("div", "care-chapter-check");
      check.append(makeCareElement("span", "lesson-kicker", "Check your understanding"), makeCareElement("strong", "", chapterQuiz.question));
      const options = makeCareElement("div", "care-chapter-check-options");
      (chapterQuiz.options || []).forEach((option, optionIndex) => {
        const label = document.createElement("label");
        const input = document.createElement("input");
        input.type = "radio";
        input.name = `lesson-quiz-${result.conversationId || Date.now()}-${chapter.number}`;
        input.value = String(optionIndex);
        label.append(input, makeCareElement("span", "", option));
        options.append(label);
      });
      const feedback = makeCareElement("p", "quiz-feedback");
      options.addEventListener("change", (event) => {
        const choice = Number(event.target.value);
        feedback.textContent = `${choice === Number(chapterQuiz.answer) ? "Correct. " : "Try again. "}${chapterQuiz.explanation}`;
        feedback.classList.toggle("is-correct", choice === Number(chapterQuiz.answer));
      });
      check.append(options, feedback);
      copy.append(check);
    }
    section.append(media, copy);
    reader.append(section);
  });

  const finish = makeCareElement("section", "care-course-finish care-course-page");
  finish.id = "lesson-finish";
  finish.dataset.coursePage = "lesson-finish";
  const callout = makeCareElement("div", "care-answer-callout");
  const calloutTitle = makeCareElement("strong", "", "When to contact a veterinarian");
  const calloutCopy = makeCareElement("span", "", answer.vet);
  callout.append(calloutTitle, calloutCopy);
  finish.append(callout);

  if (Array.isArray(answer.chart) && answer.chart.length) {
    const chart = makeCareElement("section", "care-answer-chart");
    const h4 = makeCareElement("h4", "", "Your saved seven-day pattern");
    const bars = makeCareElement("div");
    answer.chart.forEach((point) => {
      const bar = document.createElement("div");
      const fill = document.createElement("span");
      fill.style.height = `${Math.max(8, Number(point.changed || 0) * 30)}%`;
      const caption = document.createElement("small");
      caption.textContent = point.label;
      bar.append(fill, caption);
      bars.append(bar);
    });
    chart.append(h4, bars);
    finish.append(chart);
  }

  const questions = makeCareElement("section", "care-answer-questions");
  const qTitle = makeCareElement("h4", "", "Questions to carry into the next conversation");
  const qList = makeCareElement("div");
  (answer.questions || []).forEach((question) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    const text = document.createElement("span");
    text.textContent = question;
    label.append(input, text);
    qList.append(label);
  });
  questions.append(qTitle, qList);
  finish.append(questions);
  if (Array.isArray(answer.sources) && answer.sources.length) {
    const sources = makeCareElement("section", "care-lesson-sources");
    sources.append(makeCareElement("h4", "", "Sources behind this lesson"));
    const sourceList = document.createElement("ul");
    answer.sources.forEach(([text, href]) => {
      const item = document.createElement("li");
      const link = makeCareElement("a", "", text);
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      item.append(link);
      sourceList.append(item);
    });
    sources.append(sourceList);
    finish.append(sources);
  }

  const footer = makeCareElement("div", "care-answer-footer");
  (answer.nextSteps || []).forEach((step) => {
    if (step.type === "lesson") {
      const button = makeCareElement("button", "button secondary", step.label);
      button.type = "button";
      button.dataset.chatPrompt = step.prompt;
      footer.append(button);
      return;
    }
    const link = makeCareElement("a", "button secondary", step.label);
    link.href = step.href;
    footer.append(link);
  });
  if (result.privacy === "public") {
    const publicLink = makeCareElement("a", "button primary", result.published ? "View Care Circle" : "Publish to Care Circle");
    if (result.published) publicLink.href = "/community/#conversations";
    else {
      publicLink.href = "#";
      publicLink.setAttribute("role", "button");
      publicLink.dataset.publishChat = result.conversationId;
    }
    footer.append(publicLink);
  }
  if (result.quota) footer.append(makeCareElement("span", "chat-quota", `${result.quota.remaining ?? 0} of ${result.quota.limit} free lessons left today`));
  finish.append(footer);
  reader.append(finish);
  const pages = [...reader.querySelectorAll("[data-course-page]")];
  pages.forEach((page, pageIndex) => {
    const pager = makeCareElement("nav", "care-course-pager");
    pager.setAttribute("aria-label", "Lesson page navigation");
    const previous = makeCareElement("button", "button secondary", "Previous");
    previous.type = "button";
    previous.dataset.courseGo = String(pageIndex - 1);
    previous.disabled = pageIndex === 0;
    const progress = makeCareElement("span", "", `${pageIndex + 1} / ${pages.length}`);
    const next = makeCareElement("button", "button primary", pageIndex === pages.length - 1 ? "Ask another question" : "Next chapter");
    next.type = "button";
    next.dataset.courseGo = pageIndex === pages.length - 1 ? "ask" : String(pageIndex + 1);
    pager.append(previous, progress, next);
    page.append(pager);
  });
  courseLayout.append(outline, reader);
  card.append(courseLayout);
  thread.append(card);
  const showCoursePage = (pageIndex) => {
    const target = pages[pageIndex];
    if (!target) return;
    pages.forEach((page) => page.classList.toggle("is-active", page === target));
    card.querySelectorAll("[data-lesson-target]").forEach((button) => button.classList.toggle("is-active", button.dataset.lessonTarget === target.dataset.coursePage));
    card.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  card.querySelectorAll("[data-lesson-target]").forEach((button) => button.addEventListener("click", () => showCoursePage(pages.findIndex((page) => page.dataset.coursePage === button.dataset.lessonTarget))));
  card.querySelectorAll("[data-course-go]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.courseGo === "ask") {
      const form = document.querySelector("[data-care-chat-form]");
      form?.removeAttribute("hidden");
      form?.querySelector("[name='question']")?.focus();
      form?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    showCoursePage(Number(button.dataset.courseGo));
  }));
  card.scrollIntoView({ behavior: "smooth", block: "start" });
};

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-chat-prompt]");
  if (!button) return;
  const prompt = button.dataset.chatPrompt || "";
  const member = readMember();
  if (!member) {
    localStorage.setItem(pendingLessonKey, prompt);
    window.location.href = "/my-pet/#enroll";
    return;
  }
  const field = document.querySelector("[data-care-chat-form] [name='question']");
  if (!field) {
    window.location.href = `/community/?topic=${encodeURIComponent(prompt)}#ask`;
    return;
  }
  field.value = prompt;
  document.querySelector("#ask")?.scrollIntoView({ behavior: "smooth", block: "start" });
  field.focus();
});

const suggestedQuestion = new URLSearchParams(window.location.search).get("topic");
if (suggestedQuestion) {
  const suggestedField = document.querySelector("[data-care-chat-form] [name='question']");
  if (suggestedField) suggestedField.value = suggestedQuestion.slice(0, 900);
}

document.addEventListener("click", async (event) => {
  const trigger = event.target.closest("[data-load-chat]");
  if (!trigger) return;
  const member = readMember();
  if (!member) return;
  trigger.disabled = true;
  try {
    const response = await fetch(`/api/care-chat?conversationId=${encodeURIComponent(trigger.dataset.loadChat)}`, {
      headers: { accept: "application/json", ...memberHeaders(member) },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "We could not reopen that lesson.");
    const thread = document.querySelector("[data-chat-thread]");
    thread?.replaceChildren();
    document.querySelector("[data-chat-welcome]")?.setAttribute("hidden", "");
    addChatBubble(result.question, "owner");
    renderRichCareAnswer(result);
  } catch (error) {
    const note = document.querySelector("[data-care-chat-note]");
    if (note) note.textContent = error.message;
  } finally {
    trigger.disabled = false;
  }
});

document.querySelectorAll("[data-care-chat-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const member = readMember();
    const note = form.querySelector("[data-care-chat-note]");
    const button = form.querySelector("button[type='submit']");
    if (!member) return;
    const values = Object.fromEntries(new FormData(form).entries());
    const question = String(values.question || "").trim();
    if (button) { button.disabled = true; button.textContent = "Learning about your pet..."; }
    if (note) note.textContent = "";
    document.querySelector("[data-chat-welcome]")?.setAttribute("hidden", "");
    addChatBubble(question, "owner");
    const file = form.querySelector("[name='media']")?.files?.[0];
    if (file) addChatBubble(`${file.name} is attached for your reference. WoafMeow does not diagnose a pet from an image or video.`, "attachment");
    try {
      const result = await requestJson("/api/care-chat", { stage: "context", question, privacy: values.privacy, memberId: member.id, memberToken: member.token, dogId: member.dogId });
      if (result.needsContext) {
        renderCareIntake(result, member, form);
      } else {
        renderRichCareAnswer(result);
        form.reset();
        form.querySelector("[name='privacy'][value='public']").checked = true;
        form.hidden = true;
        loadCareChatHistory(member);
      }
    } catch (error) {
      if (note) note.textContent = error.message || "We could not build that answer right now.";
    } finally {
      if (button) { button.disabled = false; button.textContent = "Ask WoafMeow"; }
    }
  });
});

document.addEventListener("click", async (event) => {
  const publish = event.target.closest("[data-publish-chat]");
  if (!publish) return;
  const member = readMember();
  if (!member) return;
  publish.disabled = true;
  publish.textContent = "Publishing...";
  try {
    const result = await requestJson("/api/care-chat-publish", { conversationId: publish.dataset.publishChat, memberId: member.id, memberToken: member.token, dogId: member.dogId });
    publish.textContent = "Published";
    const note = document.createElement("span");
    note.className = "form-note";
    note.textContent = result.message;
    publish.parentElement.append(note);
    await loadCommunity();
    document.querySelector("#conversations")?.scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    publish.disabled = false;
    publish.textContent = "Publish to Care Circle";
    window.alert(error.message || "We could not publish that conversation.");
  }
});

const uploadPrivateMemoryMedia = async (file, member) => {
  if (!file) return "";
  const body = new FormData();
  body.append("memberId", member.id);
  body.append("memberToken", member.token);
  body.append("dogId", member.dogId);
  body.append("purpose", "memory");
  body.append("file", file);
  const response = await fetch("/api/media", { method: "POST", body });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "We could not upload that memory.");
  return result.media?.id || "";
};

const renderMemories = (items, member) => {
  document.querySelectorAll("[data-memory-list]").forEach((root) => {
    root.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("p");
      empty.textContent = "Your first saved moment will appear here.";
      root.append(empty);
      return;
    }
    items.forEach((item) => {
      const card = document.createElement("article");
      if (item.mediaId && item.mediaKind === "image") {
        const image = document.createElement("img");
        image.src = `/api/media/${encodeURIComponent(item.mediaId)}?memberId=${encodeURIComponent(member.id)}&memberToken=${encodeURIComponent(member.token)}`;
        image.alt = item.title;
        image.loading = "lazy";
        card.append(image);
      } else if (item.mediaId && item.mediaKind === "video") {
        const video = document.createElement("video");
        video.src = `/api/media/${encodeURIComponent(item.mediaId)}?memberId=${encodeURIComponent(member.id)}&memberToken=${encodeURIComponent(member.token)}`;
        video.controls = true;
        video.preload = "metadata";
        card.append(video);
      } else if (item.mediaId && item.mediaKind === "audio") {
        const audio = document.createElement("audio");
        audio.src = `/api/media/${encodeURIComponent(item.mediaId)}?memberId=${encodeURIComponent(member.id)}&memberToken=${encodeURIComponent(member.token)}`;
        audio.controls = true;
        card.append(audio);
      }
      const copy = document.createElement("div");
      const title = document.createElement("h4");
      title.textContent = item.title;
      const story = document.createElement("p");
      story.textContent = item.story;
      const date = document.createElement("span");
      date.textContent = new Date(item.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
      copy.append(title, story, date);
      card.append(copy);
      root.append(card);
    });
  });
};

const loadMemories = async (member) => {
  if (!member || !document.querySelector("[data-memory-list]")) return;
  try {
    const response = await fetch(`/api/memories?dogId=${encodeURIComponent(member.dogId)}`, { headers: { accept: "application/json", ...memberHeaders(member) } });
    const result = await response.json().catch(() => ({}));
    if (response.ok) renderMemories(Array.isArray(result.memories) ? result.memories : [], member);
  } catch {
    renderMemories([], member);
  }
};

document.querySelectorAll("[data-memory-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const member = readMember();
    const note = form.querySelector("[data-memory-note]");
    const button = form.querySelector("button[type='submit']");
    if (!member) return;
    const values = Object.fromEntries(new FormData(form).entries());
    const file = form.querySelector("[name='media']")?.files?.[0];
    if (button) { button.disabled = true; button.textContent = file ? "Uploading..." : "Saving..."; }
    if (note) note.textContent = "";
    try {
      const mediaId = await uploadPrivateMemoryMedia(file, member);
      const result = await requestJson("/api/memories", { title: values.title, story: values.story, mediaId, memberId: member.id, memberToken: member.token, dogId: member.dogId });
      if (note) note.textContent = result.message;
      form.reset();
      await loadMemories(member);
    } catch (error) {
      if (note) note.textContent = error.message || "We could not save that memory.";
    } finally {
      if (button) { button.disabled = false; button.textContent = "Save to the timeline"; }
    }
  });
});

document.addEventListener("click", async (event) => {
  const actionButton = event.target.closest("[data-community-action]");
  const shareButton = event.target.closest("[data-community-share]");
  const lessonButton = event.target.closest("[data-public-lesson]");
  if (lessonButton) {
    lessonButton.disabled = true;
    const previousLabel = lessonButton.textContent;
    lessonButton.textContent = "Opening...";
    try {
      const response = await fetch(`/api/public-lesson?postId=${encodeURIComponent(lessonButton.dataset.publicLesson)}`, {
        headers: { accept: "application/json" },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "We could not open that public lesson.");
      const thread = document.querySelector("[data-chat-thread]");
      thread?.replaceChildren();
      document.querySelector("[data-chat-welcome]")?.setAttribute("hidden", "");
      addChatBubble(result.question, "owner");
      renderRichCareAnswer(result);
    } catch (error) {
      window.alert(error.message || "We could not open that public lesson.");
    } finally {
      lessonButton.disabled = false;
      lessonButton.textContent = previousLabel;
    }
  }
  if (actionButton) {
    const member = readMember();
    if (!member) { window.location.href = "/my-pet/"; return; }
    actionButton.disabled = true;
    try {
      await requestJson("/api/community-action", { action: actionButton.dataset.communityAction, postId: actionButton.dataset.postId, memberId: member.id, memberToken: member.token });
      await loadCommunity();
    } catch (error) {
      actionButton.disabled = false;
      window.alert(error.message || "We could not save that action.");
    }
  }
  if (shareButton) {
    const url = `${window.location.origin}${window.location.pathname}#conversations`;
    const data = { title: shareButton.dataset.shareTitle || "Care Circle conversation", text: "A senior-pet Care Circle conversation", url };
    try {
      if (navigator.share) await navigator.share(data);
      else { await navigator.clipboard.writeText(url); shareButton.textContent = "Link copied"; }
    } catch {
      // Closing the native share sheet needs no error message.
    }
  }
});

const formatDashboardDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
};

const dashboardTable = (title, columns, rows) => {
  const section = document.createElement("section");
  section.className = "admin-data-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.append(heading);
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.textContent = "No records yet.";
    section.append(empty);
    return section;
  }
  const scroll = document.createElement("div");
  scroll.className = "admin-table-scroll";
  const table = document.createElement("table");
  const headerRow = document.createElement("tr");
  columns.forEach((column) => {
    const cell = document.createElement("th");
    cell.textContent = column.label;
    headerRow.append(cell);
  });
  const thead = document.createElement("thead");
  thead.append(headerRow);
  const tbody = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    columns.forEach((column) => {
      const cell = document.createElement("td");
      const value = row[column.key];
      cell.textContent = column.format ? column.format(value, row) : value || "—";
      tr.append(cell);
    });
    tbody.append(tr);
  });
  table.append(thead, tbody);
  scroll.append(table);
  section.append(scroll);
  return section;
};

const renderAdminDashboard = (payload) => {
  const root = document.querySelector("[data-admin-dashboard-results]");
  if (!root) return;
  root.hidden = false;
  root.replaceChildren();
  const totals = document.createElement("div");
  totals.className = "admin-totals";
  [
    ["Pet accounts", payload.totals?.pets],
    ["Newsletter", payload.totals?.newsletter],
    ["Webinar", payload.totals?.webinar],
    ["Sessions", payload.totals?.sessions],
    ["Providers", payload.totals?.providers],
    ["Remembrance", payload.totals?.memorial],
    ["Research", payload.totals?.research],
    ["Care chats", payload.totals?.chats],
    ["Memories", payload.totals?.memories],
    ["Shop orders", payload.totals?.orders],
    ["Membership checkouts", payload.totals?.memberships],
    ["Contact messages", payload.totals?.contacts],
  ].forEach(([label, value]) => {
    const item = document.createElement("article");
    const number = document.createElement("strong");
    number.textContent = String(value || 0);
    const caption = document.createElement("span");
    caption.textContent = label;
    item.append(number, caption);
    totals.append(item);
  });
  root.append(totals);
  root.append(
    dashboardTable("Newest pet accounts", [
      { key: "petName", label: "Pet" },
      { key: "species", label: "Species" },
      { key: "focus", label: "Focus" },
      { key: "ownerName", label: "Owner" },
      { key: "email", label: "Email" },
      { key: "createdAt", label: "Created", format: formatDashboardDate },
    ], payload.enrollments || []),
    dashboardTable("Newsletter signups", [
      { key: "email", label: "Email" },
      { key: "createdAt", label: "Created", format: formatDashboardDate },
    ], payload.newsletter || []),
    dashboardTable("Webinar waitlist", [
      { key: "email", label: "Email" },
      { key: "concern", label: "Care question" },
      { key: "createdAt", label: "Created", format: formatDashboardDate },
    ], payload.webinar || []),
    dashboardTable("Care Session registrations", [
      { key: "sessionTitle", label: "Session" },
      { key: "firstName", label: "Name" },
      { key: "species", label: "Pet" },
      { key: "focus", label: "Focus" },
      { key: "question", label: "Question" },
      { key: "email", label: "Email" },
      { key: "createdAt", label: "Created", format: formatDashboardDate },
    ], payload.sessions || []),
    dashboardTable("Provider listing requests", [
      { key: "organization", label: "Organization" },
      { key: "contactName", label: "Contact" },
      { key: "requestType", label: "Request" },
      { key: "serviceType", label: "Service" },
      { key: "coverage", label: "Coverage" },
      { key: "email", label: "Email" },
      { key: "createdAt", label: "Created", format: formatDashboardDate },
    ], payload.providers || []),
    dashboardTable("Remembrance collection interest", [
      { key: "firstName", label: "Name" },
      { key: "collection", label: "Collection" },
      { key: "species", label: "Pet" },
      { key: "timing", label: "Moment" },
      { key: "note", label: "Note" },
      { key: "email", label: "Email" },
      { key: "createdAt", label: "Created", format: formatDashboardDate },
    ], payload.memorial || []),
    dashboardTable("Care Circle research", [
      { key: "petName", label: "Pet" },
      { key: "query", label: "Question" },
      { key: "species", label: "Scope" },
      { key: "email", label: "Account" },
      { key: "createdAt", label: "Created", format: formatDashboardDate },
    ], payload.research || []),
    dashboardTable("Care chats", [
      { key: "petName", label: "Pet" },
      { key: "title", label: "Question" },
      { key: "topic", label: "Topic" },
      { key: "privacy", label: "Privacy" },
      { key: "status", label: "Status" },
      { key: "email", label: "Account" },
      { key: "createdAt", label: "Created", format: formatDashboardDate },
    ], payload.chats || []),
    dashboardTable("Pet memory timeline", [
      { key: "petName", label: "Pet" },
      { key: "title", label: "Memory" },
      { key: "email", label: "Account" },
      { key: "createdAt", label: "Created", format: formatDashboardDate },
    ], payload.memories || []),
    dashboardTable("Shop orders", [
      { key: "customerName", label: "Customer" },
      { key: "email", label: "Email" },
      { key: "shippingRegion", label: "Region" },
      { key: "itemsJson", label: "Items" },
      { key: "subtotalCents", label: "Subtotal", format: (value) => `$${(Number(value || 0) / 100).toFixed(2)}` },
      { key: "status", label: "Status" },
      { key: "createdAt", label: "Created", format: formatDashboardDate },
    ], payload.orders || []),
    dashboardTable("Membership checkouts", [
      { key: "email", label: "Email" },
      { key: "plan", label: "Plan" },
      { key: "amountCents", label: "Price", format: (value) => `$${(Number(value || 0) / 100).toFixed(2)}` },
      { key: "status", label: "Status" },
      { key: "createdAt", label: "Created", format: formatDashboardDate },
    ], payload.memberships || []),
    dashboardTable("Contact messages", [
      { key: "name", label: "Name" },
      { key: "email", label: "Email" },
      { key: "topic", label: "Topic" },
      { key: "message", label: "Message" },
      { key: "status", label: "Status" },
      { key: "createdAt", label: "Created", format: formatDashboardDate },
    ], payload.contacts || [])
  );
};

let adminDashboardKey = "";

const renderAdminProducts = (products) => {
  const root = document.querySelector("[data-admin-product-list]");
  if (!root) return;
  root.replaceChildren();
  if (!products.length) {
    const empty = document.createElement("p");
    empty.textContent = "No staff-added products yet.";
    root.append(empty);
    return;
  }
  products.forEach((product) => {
    const item = document.createElement("article");
    item.className = "admin-product-row";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = product.title;
    const meta = document.createElement("span");
    meta.textContent = `${String(product.category || "").replace(/-/g, " ")} · ${money(product.priceCents)} · ${product.active ? "Published" : "Hidden"}`;
    copy.append(title, meta);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button secondary";
    button.textContent = product.active ? "Hide" : "Publish";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const response = await fetch("/api/admin-products", {
          method: "PATCH",
          headers: { "content-type": "application/json", "x-woafy-admin-key": adminDashboardKey },
          body: JSON.stringify({ slug: product.slug, active: !product.active }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "The product could not be updated.");
        await loadAdminProducts();
      } catch (error) {
        window.alert(error.message || "The product could not be updated.");
      } finally {
        button.disabled = false;
      }
    });
    item.append(copy, button);
    root.append(item);
  });
};

const loadAdminProducts = async () => {
  if (!adminDashboardKey) return;
  const response = await fetch("/api/admin-products", {
    headers: { "x-woafy-admin-key": adminDashboardKey, accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Products could not be loaded.");
  renderAdminProducts(payload.products || []);
};

document.querySelectorAll("[data-admin-product-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const note = form.querySelector("[data-admin-product-note]");
    const button = form.querySelector("button[type='submit']");
    const values = Object.fromEntries(new FormData(form).entries());
    if (button) { button.disabled = true; button.textContent = "Publishing..."; }
    if (note) note.textContent = "";
    try {
      const response = await fetch("/api/admin-products", {
        method: "POST",
        headers: { "content-type": "application/json", "x-woafy-admin-key": adminDashboardKey },
        body: JSON.stringify({
          ...values,
          details: String(values.details || "").split(/\n+/).map((item) => item.trim()).filter(Boolean),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The product could not be published.");
      form.reset();
      if (note) note.textContent = payload.message;
      await loadAdminProducts();
    } catch (error) {
      if (note) note.textContent = error.message || "The product could not be published.";
    } finally {
      if (button) { button.disabled = false; button.textContent = "Publish product"; }
    }
  });
});

document.querySelectorAll("[data-admin-dashboard-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const key = form.querySelector("[name='key']")?.value || "";
    const note = form.querySelector("[data-admin-dashboard-note]");
    const button = form.querySelector("button[type='submit']");
    if (button) {
      button.disabled = true;
      button.textContent = "Opening...";
    }
    if (note) note.textContent = "";
    try {
      const response = await fetch("/api/admin", { headers: { "x-woafy-admin-key": key, accept: "application/json" } });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The private dashboard could not be opened.");
      adminDashboardKey = key;
      renderAdminDashboard(result);
      const productManager = document.querySelector("[data-admin-product-manager]");
      if (productManager) productManager.hidden = false;
      await loadAdminProducts();
      if (note) note.textContent = "Dashboard loaded for this browser session.";
    } catch (error) {
      if (note) note.textContent = error.message || "The private dashboard could not be opened.";
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "Open dashboard";
      }
    }
  });
});

applyMemberState();
loadCircles();
loadCommunity();
loadCommunityResearch();
