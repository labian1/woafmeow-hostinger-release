const WOAFMEOW_OWNER_ACTIVITY_API =
  "https://woafypet-senior-care-8kt.pages.dev/api/activity";
const notifyWoafMeowOwner = async (eventType, account = null, properties = {}) => {
  const identity = account || (() => {
    try {
      return JSON.parse(localStorage.getItem("woafmeow-account-v1") || "null");
    } catch {
      return null;
    }
  })();
  if (!identity?.email) return false;
  try {
    const response = await fetch(WOAFMEOW_OWNER_ACTIVITY_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        eventType,
        email: identity.email,
        ownerName: identity.ownerName,
        petName: identity.petName,
        properties: { page_path: window.location.pathname, ...properties },
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
};

(() => {
  const toggle = document.querySelector("[data-menu-toggle]");
  const navigation = document.querySelector("[data-site-nav]");

  const setMenu = (open) => {
    if (!toggle || !navigation) return;
    toggle.setAttribute("aria-expanded", String(open));
    navigation.classList.toggle("is-open", open);
    document.body.classList.toggle("menu-open", open);
    const label = toggle.querySelector(".sr-only");
    if (label)
      label.textContent = open ? "Close navigation" : "Open navigation";
  };

  toggle?.addEventListener("click", () => {
    setMenu(toggle.getAttribute("aria-expanded") !== "true");
  });

  navigation?.addEventListener("click", (event) => {
    if (event.target.closest("a")) setMenu(false);
  });

  const navGroups = [...document.querySelectorAll(".nav-group")];
  navGroups.forEach((group) => {
    group.addEventListener("toggle", () => {
      if (!group.open) return;
      navGroups.forEach((other) => {
        if (other !== group) other.open = false;
      });
    });
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest(".nav-group")) return;
    navGroups.forEach((group) => {
      group.open = false;
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setMenu(false);
      toggle?.focus();
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 900) setMenu(false);
  });

  document.querySelectorAll("[data-preview-form]").forEach((form) => {
    const showGuideFallback = (note, guideUrl) => {
      const requestedUrl = String(guideUrl || "");
      const fallbackUrl = /WoafMeow_Senior_Dog_Care_Field_Guide\.pdf(?:$|[?#])/i.test(
        requestedUrl,
      )
        ? requestedUrl
        : "/assets/WoafMeow_Senior_Dog_Care_Field_Guide.pdf";
      const link = document.createElement("a");
      link.href = fallbackUrl;
      link.textContent = "Download the complete guide PDF now →";
      note.replaceChildren(
        document.createTextNode("The email was not sent. "),
        link,
      );
      note.classList.add("is-confirmed");
    };
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const note = form.querySelector("[data-form-note]");
      if (!note) return;
      const stored = Object.fromEntries(new FormData(form).entries());
      const endpoint = form.dataset.submitApi;
      if (endpoint) {
        const isGuideDelivery = form.hasAttribute("data-guide-delivery");
        const isOwnerMatch = form.hasAttribute("data-owner-match-form");
        const isCheckout = form.hasAttribute("data-checkout-form");
        if (isOwnerMatch && String(stored.message || "").trim().length < 12) {
          note.textContent =
            "Tell us a little more about what you hope to talk through.";
          note.classList.remove("is-confirmed");
          form.querySelector("[name='message']")?.focus();
          return;
        }
        const requestId = isOwnerMatch
          ? `WM-${Date.now().toString(36).toUpperCase()}`
          : "";
        const button = form.querySelector("button[type='submit']");
        if (button) button.disabled = true;
        note.textContent = "Sending…";
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              ...stored,
              topic:
                stored.topic ||
                (!isOwnerMatch && endpoint.endsWith("/api/contact")
                  ? "other"
                  : stored.topic),
              consent:
                stored.consent === "true" ||
                stored.consent === "on" ||
                (!isOwnerMatch && endpoint.endsWith("/api/contact")),
              guideConsent:
                isGuideDelivery ||
                stored.guideConsent === "true" ||
                stored.guideConsent === "on",
              ...(requestId
                ? {
                    requestId,
                    submittedAt: new Date().toISOString(),
                    workflowStatus: "pending-team-review",
                  }
                : {}),
              pageContext: window.location.href,
            }),
          });
          const result = await response.json().catch(() => ({}));
          if (
            !response.ok ||
            (isGuideDelivery && result.delivery !== "sent") ||
            result.delivery === "fallback"
          ) {
            if (isGuideDelivery) {
              showGuideFallback(
                note,
                result.guideUrl || form.dataset.guideUrl,
              );
              return;
            }
            throw new Error(result.error || "The request was not sent.");
          }
          if (isCheckout) {
            const checkoutUrl = new URL(String(result.checkoutUrl || ""));
            if (
              checkoutUrl.protocol !== "https:" ||
              checkoutUrl.hostname !== "checkout.stripe.com"
            ) {
              throw new Error("Secure Stripe checkout did not open correctly.");
            }
            note.textContent = "Opening secure Stripe checkout…";
            note.classList.add("is-confirmed");
            window.location.assign(checkoutUrl.href);
            return;
          }
          note.textContent = result.message || form.dataset.successMessage || "Thank you. Your request was sent.";
          note.classList.add("is-confirmed");
          form.reset();
        } catch (error) {
          if (isGuideDelivery) {
            showGuideFallback(note, form.dataset.guideUrl);
          } else {
            const networkFailure =
              error instanceof TypeError ||
              (error instanceof Error && /failed to fetch|network/i.test(error.message));
            note.textContent = networkFailure
              ? "We could not reach the WoafMeow service. Your request was not sent. Please try again shortly."
              : error instanceof Error && error.message
                ? error.message
                : "We could not send this right now. Please try again.";
            note.classList.remove("is-confirmed");
          }
        } finally {
          if (button) button.disabled = false;
        }
        return;
      }
      try {
        localStorage.setItem(
          `woafmeow-form-${form.id || form.dataset.formTitle || "request"}`,
          JSON.stringify(stored),
        );
        note.textContent = "Saved in this browser.";
      } catch {
        note.textContent = "Your details are ready on this screen.";
      }
      note.classList.add("is-confirmed");
      note.setAttribute("aria-live", "polite");
      note.focus?.({ preventScroll: true });
    });

    form.addEventListener("input", () => {
      const note = form.querySelector("[data-form-note]");
      if (note?.classList.contains("is-confirmed")) {
        note.textContent = "";
        note.classList.remove("is-confirmed");
      }
    });
  });

  document.querySelectorAll("[data-provider-inquiry-form]").forEach((form) => {
    const endpoint = form.dataset.providerApi;
    const note = form.querySelector("[data-provider-inquiry-note]");
    const button = form.querySelector("button[type='submit']");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;

      const values = Object.fromEntries(new FormData(form).entries());
      if (values.companyWebsite) {
        form.reset();
        if (note)
          note.textContent =
            "Thank you. Your practice was submitted for review.";
        return;
      }
      if (!endpoint) {
        if (note) note.textContent = "Submission is temporarily unavailable.";
        return;
      }

      const payload = {
        ...values,
        coverage: [values.city, values.region].filter(Boolean).join(", "),
        consent: values.consent === "on",
        pageContext: window.location.href,
      };
      if (button) button.disabled = true;
      if (note) note.textContent = "Submitting…";
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            result.error || "We could not submit the practice right now.",
          );
        }
        form.reset();
        if (note) {
          note.textContent =
            result.message || "Thank you. Your practice was submitted for review.";
          note.classList.add("is-confirmed");
        }
      } catch (error) {
        if (note) {
          note.textContent =
            error instanceof Error && error.message
              ? error.message
              : "We could not submit the practice right now. Please try again.";
          note.classList.remove("is-confirmed");
        }
      } finally {
        if (button) button.disabled = false;
      }
    });
  });

  document
    .querySelector("[data-print-guide]")
    ?.addEventListener("click", () => window.print());

  const currentPath = window.location.pathname.replace(/index\.html$/, "");

  const carePathRoot = document.querySelector("[data-care-path]");
  if (carePathRoot && /^\/care-path\/?$/.test(currentPath)) {
    const query = (new URLSearchParams(window.location.search).get("q") || "")
      .slice(0, 300)
      .trim();
    const displayedQuery = query || "a change in your senior dog’s routine";

    const carePaths = {
      mobility: {
        slug: "slower-after-rest",
        title: "Start with mobility and stiffness",
        summary:
          "Learn what to notice after rest, what to make safer today, and what to record for your veterinarian.",
        chapters: {
          notice: {
            title: "Notice the mobility pattern",
            summary:
              "Compare first steps, turning, stairs, slipping, and recovery after rest.",
          },
          today: {
            title: "Make movement safer today",
            summary:
              "Use traction, easier access, shorter routes, and comfortable rest without forcing activity.",
          },
          discuss: {
            title: "Prepare the right veterinary conversation",
            summary:
              "Bring timing, frequency, short videos, and the activities that have become harder.",
          },
        },
      },
      night: {
        slug: "restless-at-night",
        title: "Start with nighttime changes",
        summary:
          "Separate a one-off restless night from a pattern and prepare useful observations for your care team.",
        chapters: {
          notice: {
            title: "Notice the nighttime pattern",
            summary:
              "Track pacing, waking, confusion, vocalizing, and what happens before and after each episode.",
          },
          today: {
            title: "Create a calmer night tonight",
            summary:
              "Keep routes clear, lighting gentle, bathroom access easy, and the bedtime routine predictable.",
          },
          discuss: {
            title: "Know what to discuss with your veterinarian",
            summary:
              "Share onset, frequency, sleep disruption, pain signs, bathroom changes, and any new medication.",
          },
        },
      },
      appetite: {
        slug: "changes-in-appetite",
        title: "Start with appetite and weight changes",
        summary:
          "Learn what details make an eating change meaningful and what deserves a prompt veterinary call.",
        chapters: {
          notice: {
            title: "Notice what changed around meals",
            summary:
              "Record interest in food, chewing, nausea signs, portions eaten, water intake, and weight trend.",
          },
          today: {
            title: "Support safer, easier meals today",
            summary:
              "Keep food familiar, make bowls easy to reach, and avoid unapproved supplements or abrupt diet changes.",
          },
          discuss: {
            title: "Prepare the right veterinary conversation",
            summary:
              "Bring the timeline, amounts eaten, weight changes, medications, vomiting, stool, and dental clues.",
          },
        },
      },
      water: {
        slug: "drinking-more-water",
        title: "Start with drinking and bathroom changes",
        summary:
          "Turn changes in thirst, urination, or accidents into clear observations your veterinarian can use.",
        chapters: {
          notice: {
            title: "Notice the drinking and bathroom pattern",
            summary:
              "Track frequency, approximate amount, urgency, accidents, urine appearance, and related behavior.",
          },
          today: {
            title: "Keep access safe and comfortable",
            summary:
              "Keep fresh water available, add easy bathroom opportunities, and do not restrict water unless a veterinarian directs it.",
          },
          discuss: {
            title: "Know when to call and what to share",
            summary:
              "Report the timeline and paired signs; inability to urinate, collapse, or severe distress needs urgent care.",
          },
        },
      },
      general: {
        slug: "less-interest-in-life",
        title: "Start by turning the change into a clear pattern",
        summary:
          "Use a simple baseline, safe next steps, and focused notes to decide what to discuss with your veterinarian.",
        chapters: {
          notice: {
            title: "Notice what is different",
            summary:
              "Record when it began, how often it happens, what comes before it, and how it affects daily life.",
          },
          today: {
            title: "Choose a safer next step today",
            summary:
              "Reduce avoidable strain, keep routines predictable, and avoid treatments that have not been approved for your dog.",
          },
          discuss: {
            title: "Prepare a focused veterinary conversation",
            summary:
              "Bring a short timeline, photos or video when safe, medications, and the questions you most need answered.",
          },
        },
      },
    };

    const keywordGroups = [
      [
        "mobility",
        /\b(stiff|stiffness|rise|rising|limp|limping|stairs?|mobility|slip|slipping)\b/i,
      ],
      [
        "night",
        /\b(nights?|pacing|sleep|sleeping|restless|restlessness|confused|confusion)\b/i,
      ],
      ["appetite", /\b(appetite|food|eating|eat|nausea|nauseous|weight)\b/i],
      [
        "water",
        /\b(water|drink|drinking|pee|peeing|urine|urinating|bathroom|accident|accidents)\b/i,
      ],
    ];
    const selectedKey =
      keywordGroups.find(([, pattern]) => pattern.test(query))?.[0] ||
      "general";
    const selectedPath = carePaths[selectedKey];

    carePathRoot.dataset.carePath = selectedKey;
    document.querySelectorAll("[data-care-query]").forEach((element) => {
      element.textContent = displayedQuery;
    });
    document.querySelectorAll("[data-care-lesson-title]").forEach((element) => {
      element.textContent = selectedPath.title;
    });
    document
      .querySelectorAll("[data-care-lesson-summary]")
      .forEach((element) => {
        element.textContent = selectedPath.summary;
      });
    document.querySelectorAll("[data-care-lesson-link]").forEach((link) => {
      link.setAttribute("href", `/learn/${selectedPath.slug}/?personalize=1`);
    });

    Object.entries(selectedPath.chapters).forEach(([chapterKey, chapter]) => {
      document
        .querySelectorAll(`[data-care-chapter-link="${chapterKey}"]`)
        .forEach((link) => {
          link.setAttribute("href", `#chapter-${chapterKey}`);
          const shortLabels = {
            notice: "Notice",
            today: "Support today",
            discuss: "Prepare",
          };
          const label = link.querySelector("span");
          if (label) label.textContent = shortLabels[chapterKey];
        });
      document
        .querySelectorAll(`[data-care-chapter-title="${chapterKey}"]`)
        .forEach((element) => {
          element.textContent = chapter.title;
        });
      document
        .querySelectorAll(`[data-care-chapter-summary="${chapterKey}"]`)
        .forEach((element) => {
          element.textContent = chapter.summary;
        });
    });
  }

  const lessonTailoring = {
    "slower-after-rest": [
      (condition) =>
        `Watch ${condition} once during an ordinary routine; record the pause, first steps, slipping, and recovery.`,
      (condition) =>
        `Make the route around ${condition} easier with traction, shorter access, and one change at a time.`,
      (condition) =>
        `Tell your veterinarian when ${condition} began, how often it occurs, what helps, and which activity is now harder.`,
    ],
    "restless-at-night": [
      (condition) =>
        `Record when ${condition} begins, the exact sequence that follows, and what finally helps your dog settle.`,
      (condition) =>
        `Make tonight easier around ${condition} with a clear route, water, bathroom access, and gentle light.`,
      (condition) =>
        `Report the timing, breathing, toileting, pain clues, medicines, and how often ${condition} occurs.`,
    ],
    "changes-in-appetite": [
      (condition) =>
        `Measure food offered and eaten when ${condition} occurs; add water, stool, vomiting, and energy.`,
      (condition) =>
        `Watch chewing, swallowing, nausea clues, and mouth comfort around ${condition}.`,
      (condition) =>
        `Report the duration, amounts, weight, medicines, and paired signs that come with ${condition}.`,
    ],
    "drinking-more-water": [
      (condition) =>
        `Measure one ordinary day when you notice ${condition}, while keeping fresh water freely available.`,
      (condition) =>
        `Pair ${condition} with urine, appetite, energy, medicines, temperature, and recent food changes.`,
      (condition) =>
        `Report the measured change, timeline, and paired signs; ask how soon your dog should be examined.`,
    ],
    "less-interest-in-life": [
      (condition) =>
        `Choose one familiar routine affected by ${condition}; record whether your dog starts, joins, finishes, or avoids it.`,
      () =>
        "Offer a shorter, lower-effort version of that routine and let your dog choose whether to join.",
      (condition) =>
        `Report onset, frequency, movement, sleep, appetite, senses, and medicines alongside ${condition}.`,
    ],
    "bathroom-accidents": [
      (condition) =>
        `Record the time and sequence around ${condition}: last trip, route, urgency, posture, amount, and distress.`,
      () =>
        "Make access easier with a shorter, well-lit, non-slip route and more frequent calm opportunities.",
      (condition) =>
        `Report output, straining, pain, thirst, vomiting, medicines, and how often ${condition} occurs.`,
    ],
  };

  document.querySelectorAll("[data-lesson-intake]").forEach((intake) => {
    const buildButton = intake.querySelector("[data-build-lesson]");
    const error = intake.querySelector("[data-intake-error]");
    const course = document.querySelector("[data-tailored-course]");
    const urgentResult = document.querySelector("[data-urgent-intake-result]");
    const profile = document.querySelector("[data-tailored-profile]");
    const priority = document.querySelector("[data-tailored-priority]");
    const chapterSummaries = course
      ? [...course.querySelectorAll("[data-tailored-chapter-summary]")]
      : [];
    const personalizer = intake.closest("[data-lesson-personalizer]");
    const wantsPersonalization =
      new URLSearchParams(window.location.search).get("personalize") === "1";
    let hasSeenPersonalizer = false;
    try {
      hasSeenPersonalizer =
        localStorage.getItem("woafmeow-lesson-personalizer-seen") === "1";
    } catch {
      hasSeenPersonalizer = false;
    }
    if (personalizer && wantsPersonalization && !hasSeenPersonalizer) {
      personalizer.hidden = false;
      try {
        localStorage.setItem("woafmeow-lesson-personalizer-seen", "1");
      } catch {
        // The public course remains available even when storage is disabled.
      }
    }

    const selectValue = (name) =>
      intake.querySelector(`[data-intake-field="${name}"]`)?.value.trim() || "";

    intake.addEventListener("change", () => {
      if (error) error.hidden = true;
    });

    buildButton?.addEventListener("click", () => {
      const requiredNames = ["age", "condition", "duration", "impact"];
      const missingField = requiredNames
        .map((name) => intake.querySelector(`[data-intake-field="${name}"]`))
        .find((element) => !element?.value);
      const urgentChoice = intake.querySelector(
        '[data-intake-field="urgent"]:checked',
      );

      if (missingField || !urgentChoice) {
        if (error) error.hidden = false;
        (
          missingField || intake.querySelector('[data-intake-field="urgent"]')
        )?.focus();
        return;
      }

      if (error) error.hidden = true;
      if (urgentChoice.value === "yes") {
        if (course) course.hidden = true;
        if (urgentResult) {
          urgentResult.hidden = false;
          urgentResult.focus({ preventScroll: true });
          urgentResult.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        return;
      }

      if (urgentResult) urgentResult.hidden = true;
      const context = selectValue("context");
      const condition = selectValue("condition");
      const conditionPhrase = condition
        ? `${condition.charAt(0).toLocaleLowerCase()}${condition.slice(1)}`
        : "the selected change";
      const templates = lessonTailoring[intake.dataset.lessonSlug] || [
        (value) =>
          `Observe ${value} once during an ordinary routine and record what happens before and after.`,
        (value) =>
          `Choose one low-risk change that makes ${value} safer or easier today.`,
        (value) =>
          `Bring the timeline for ${value}, what helps, and what daily activity has become harder to your veterinarian.`,
      ];
      const completeTemplates =
        templates.length >= 4
          ? templates
          : [
              ...templates,
              (value) =>
                `Know which sudden, painful or worsening signs around ${value} mean your dog needs faster veterinary care.`,
            ];
      const tailoredSummaries = completeTemplates.map((template) =>
        template(conditionPhrase),
      );
      if (profile) {
        profile.textContent = `${selectValue("age")} · ${condition} · ${selectValue("duration")} · ${selectValue("impact")}${context ? ` · Context: ${context}` : ""}`;
      }
      if (priority) priority.textContent = tailoredSummaries[0];
      chapterSummaries.forEach((summary, index) => {
        summary.textContent = tailoredSummaries[index] || summary.textContent;
      });
      if (course) {
        course.hidden = false;
        course.classList.add("is-ready");
        course.focus({ preventScroll: true });
        course.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      if (personalizer) personalizer.hidden = true;
    });
  });

  document.querySelectorAll("[data-chapter-quiz]").forEach((quiz) => {
    const checkButton = quiz.querySelector("[data-check-quiz]");
    const feedback = quiz.querySelector("[data-quiz-feedback]");
    checkButton?.addEventListener("click", () => {
      const selected = quiz.querySelector('input[type="radio"]:checked');
      if (!selected) {
        if (feedback) feedback.textContent = "Choose one answer first.";
        quiz.classList.remove("is-correct");
        quiz.classList.add("needs-answer");
        return;
      }
      const correct = selected.value === quiz.dataset.answer;
      if (feedback) {
        feedback.textContent = correct
          ? quiz.dataset.correctMessage || "Correct."
          : quiz.dataset.retryMessage || "Try again.";
      }
      quiz.classList.toggle("is-correct", correct);
      quiz.classList.toggle("needs-answer", !correct);
    });
  });

  const circleFilters = [...document.querySelectorAll("[data-circle-filter]")];
  const circlePosts = [...document.querySelectorAll("[data-care-post]")];
  circleFilters.forEach((filter) => {
    filter.addEventListener("click", () => {
      const selectedTopic = filter.dataset.circleFilter;
      circleFilters.forEach((candidate) => {
        candidate.setAttribute("aria-pressed", String(candidate === filter));
      });
      circlePosts.forEach((post) => {
        post.hidden =
          selectedTopic !== "all" && post.dataset.topic !== selectedTopic;
      });
    });
  });

  document.querySelectorAll("[data-preview-like]").forEach((button) => {
    const count = button.querySelector("[data-like-count]");
    const baseCount = Number(
      button.dataset.baseCount || count?.textContent || 0,
    );
    button.addEventListener("click", () => {
      const liked = button.getAttribute("aria-pressed") !== "true";
      button.setAttribute("aria-pressed", String(liked));
      if (count) count.textContent = String(baseCount + (liked ? 1 : 0));
    });
  });

  document.querySelectorAll("[data-comments-toggle]").forEach((button) => {
    const comments = button
      .closest("[data-care-post]")
      ?.querySelector("[data-preview-comments]");
    button.addEventListener("click", () => {
      if (!comments) return;
      const willOpen = comments.hidden;
      comments.hidden = !willOpen;
      button.setAttribute("aria-expanded", String(willOpen));
      if (willOpen)
        comments.querySelector("article")?.focus?.({ preventScroll: true });
    });
  });

  document
    .querySelectorAll("[data-community-interaction]")
    .forEach((interaction) => {
      const key = interaction.dataset.communityInteraction || "lesson";
      const likeButton = interaction.querySelector("[data-local-like]");
      const likeCount = likeButton?.querySelector("[data-like-count]");
      const baseLikes = Number(
        likeButton?.dataset.baseCount || likeCount?.textContent || 0,
      );
      const commentsButton = interaction.querySelector(
        "[data-local-comments-toggle]",
      );
      const commentsPanel = interaction.querySelector("[data-local-comments]");
      const commentForm = interaction.querySelector(
        "[data-local-comment-form]",
      );
      const commentList = interaction.querySelector(
        "[data-local-comment-list]",
      );
      const commentCount = interaction.querySelector("[data-comment-count]");
      const storageKey = `woafmeow-community-${key}`;
      let saved = { liked: false, comments: [] };
      try {
        saved = {
          ...saved,
          ...JSON.parse(localStorage.getItem(storageKey) || "{}"),
        };
      } catch {
        saved = { liked: false, comments: [] };
      }

      const render = () => {
        if (likeButton)
          likeButton.setAttribute("aria-pressed", String(Boolean(saved.liked)));
        if (likeCount)
          likeCount.textContent = String(baseLikes + (saved.liked ? 1 : 0));
        const existingLocal =
          commentList?.querySelectorAll("[data-local-comment]").length || 0;
        if (commentList && existingLocal === 0) {
          saved.comments.forEach((copy) => {
            const article = document.createElement("article");
            article.dataset.localComment = "true";
            const name = document.createElement("strong");
            name.textContent = "You";
            const paragraph = document.createElement("p");
            paragraph.textContent = copy;
            article.append(name, paragraph);
            commentList.append(article);
          });
        }
        if (commentCount) {
          commentCount.textContent = String(
            commentList?.querySelectorAll("article").length || 0,
          );
        }
      };

      const save = () => {
        try {
          localStorage.setItem(storageKey, JSON.stringify(saved));
        } catch {
          // Interaction still works for the current page view.
        }
      };

      likeButton?.addEventListener("click", () => {
        saved.liked = !saved.liked;
        save();
        render();
        void notifyWoafMeowOwner(
          saved.liked
            ? "care_circle_reaction_added"
            : "care_circle_reaction_removed",
          null,
          { lesson_key: key },
        );
      });
      commentsButton?.addEventListener("click", () => {
        if (!commentsPanel) return;
        const open = commentsPanel.hidden;
        commentsPanel.hidden = !open;
        commentsButton.setAttribute("aria-expanded", String(open));
        if (open)
          commentForm
            ?.querySelector("textarea")
            ?.focus({ preventScroll: true });
      });
      commentForm?.addEventListener("submit", (event) => {
        event.preventDefault();
        const field = commentForm.querySelector("textarea");
        const copy = field?.value.trim() || "";
        if (!copy) return;
        saved.comments.push(copy.slice(0, 600));
        save();
        if (field) field.value = "";
        const status = commentForm.querySelector("[data-local-comment-status]");
        if (status) status.textContent = "Comment added.";
        const article = document.createElement("article");
        article.dataset.localComment = "true";
        const name = document.createElement("strong");
        name.textContent = "You";
        const paragraph = document.createElement("p");
        paragraph.textContent = copy.slice(0, 600);
        article.append(name, paragraph);
        commentList?.append(article);
        if (commentCount)
          commentCount.textContent = String(
            commentList?.querySelectorAll("article").length || 0,
          );
        void notifyWoafMeowOwner("care_circle_comment_added", null, {
          lesson_key: key,
        });
      });
      render();
    });

  const treeDialog = document.querySelector("[data-tree-purchase]");
  const checkoutStatus = document.querySelector("[data-checkout-status]");
  const checkoutState = new URLSearchParams(window.location.search).get(
    "checkout",
  );
  if (checkoutStatus && checkoutState === "success") {
    checkoutStatus.textContent =
      "Stripe returned you after checkout. We are confirming the payment now; your memorial email will arrive after confirmation.";
    checkoutStatus.classList.add("is-confirmed");
  } else if (checkoutStatus && checkoutState === "cancelled") {
    checkoutStatus.textContent =
      "Checkout was cancelled. No payment was completed.";
  }
  document.querySelectorAll("[data-tree-purchase-open]").forEach((button) => {
    button.addEventListener("click", () => {
      if (treeDialog?.showModal) treeDialog.showModal();
    });
  });
  document
    .querySelector("[data-tree-purchase-close]")
    ?.addEventListener("click", () => treeDialog?.close());
  treeDialog?.addEventListener("click", (event) => {
    if (event.target === treeDialog) treeDialog.close();
  });

  const accountStorageKey = "woafmeow-account-v1";
  const publicQuestionStorageKey = "woafmeow-public-question-v1";
  const publicLessonsStorageKey = "woafmeow-public-lessons-v1";
  const privateLessonStorageKey = "woafmeow-private-lessons-v1";
  const readStoredJson = (key) => {
    try {
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch {
      return null;
    }
  };
  const writeStoredJson = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  };
  const getAccount = () => readStoredJson(accountStorageKey);
  const getPublicQuestion = () => readStoredJson(publicQuestionStorageKey);
  const getPublicLessons = () => {
    const lessons = readStoredJson(publicLessonsStorageKey);
    return Array.isArray(lessons) ? lessons : [];
  };
  const getPrivateLessons = () => {
    const lessons = readStoredJson(privateLessonStorageKey);
    return Array.isArray(lessons) ? lessons : [];
  };
  const normalizedOwnerKey = (value) =>
    String(value || "").trim().toLocaleLowerCase();
  const lessonBelongsToAccount = (lesson, account = getAccount()) =>
    Boolean(
      lesson &&
        account?.email &&
        normalizedOwnerKey(lesson.ownerKey || lesson.email) ===
          normalizedOwnerKey(account.email),
    );
  const removePublicLesson = async (lessonId) => {
    const id = String(lessonId || "");
    const lesson = getPublicLessons().find((item) => item?.id === id);
    if (!lessonBelongsToAccount(lesson)) return false;
    const remaining = getPublicLessons().filter((item) => item?.id !== id);
    if (!writeStoredJson(publicLessonsStorageKey, remaining)) return false;
    const current = getPublicQuestion();
    if (current?.id === id) {
      try {
        localStorage.removeItem(publicQuestionStorageKey);
      } catch {
        return false;
      }
    }
    await notifyWoafMeowOwner("public_care_lesson_deleted", getAccount(), {
      lesson_id: id,
      lesson_slug: lesson.slug || "",
    });
    return true;
  };
  const safeImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  const readImageFile = (
    file,
    { maxBytes = 8 * 1024 * 1024, maxDimension = 720, quality = 0.82 } = {},
  ) =>
    new Promise((resolve, reject) => {
      if (!(file instanceof File) || !file.name) {
        reject(new Error("Choose an image first."));
        return;
      }
      if (!safeImageTypes.has(file.type)) {
        reject(new Error("Choose a JPG, PNG or WebP image."));
        return;
      }
      if (file.size > maxBytes) {
        reject(
          new Error(
            `Choose an image smaller than ${Math.round(maxBytes / 1024 / 1024)} MB.`,
          ),
        );
        return;
      }

      const reader = new FileReader();
      reader.onerror = () => reject(new Error("This image could not be read."));
      reader.onload = () => {
        const source = new Image();
        source.onerror = () =>
          reject(new Error("This image could not be previewed."));
        source.onload = () => {
          const largestSide = Math.max(source.naturalWidth, source.naturalHeight);
          const scale = Math.min(1, maxDimension / Math.max(1, largestSide));
          const width = Math.max(1, Math.round(source.naturalWidth * scale));
          const height = Math.max(1, Math.round(source.naturalHeight * scale));
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          if (!context) {
            reject(new Error("This browser could not prepare the image."));
            return;
          }
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, width, height);
          context.drawImage(source, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        source.src = String(reader.result || "");
      };
      reader.readAsDataURL(file);
    });
  const renderStoredImage = (node, dataUrl, alt) => {
    if (!node) return;
    const image = node.matches("img")
      ? node
      : node.querySelector("img") || document.createElement("img");
    if (!node.matches("img") && !image.isConnected) node.append(image);
    if (dataUrl) {
      image.src = dataUrl;
      image.alt = alt;
      node.hidden = false;
    } else {
      image.removeAttribute("src");
      image.alt = "";
      node.hidden = true;
    }
  };
  const selectLessonSlug = (question) => {
    const value = question.toLocaleLowerCase();
    if (
      /\b(medicine|medication|prescription|dose|dosage|drug|pill|tablet|capsule|side effect)\b/.test(
        value,
      )
    )
      return "after-a-medicine-change";
    if (/\b(tooth|teeth|dental|mouth|gum|gums|oral|bad breath)\b/.test(value))
      return "mouth-or-dental-pain";
    if (/\b(cough|coughing|breath|breathing|wheez|panting)\b/.test(value))
      return "new-cough-or-breathing-change";
    if (/\b(lump|bump|mass|skin|rash|itch|itching|sore|coat)\b/.test(value))
      return "new-lump-or-skin-change";
    if (
      /\b(vision|sight|blind|hearing|hear|deaf|startle|bumping into)\b/.test(
        value,
      )
    )
      return "vision-or-hearing-change";
    if (
      /\b(weight|weigh|heavier|lighter|thin|skinny|gaining|losing)\b|\bweight (?:gain|loss)\b/.test(
        value,
      )
    )
      return "unexpected-weight-change";
    if (
      /\b(stiff|rise|rising|limp|stairs?|mobility|slip|walk|walking|joint)\b/.test(
        value,
      )
    )
      return "slower-after-rest";
    if (/\b(night|sleep|pacing|wake|waking|restless|confus)\b/.test(value))
      return "restless-at-night";
    if (
      /\b(food|eat|eating|appetite|chew|nausea|meal|weight loss)\b/.test(value)
    )
      return "changes-in-appetite";
    if (/\b(water|drink|drinking|thirst|urine|urinating|pee)\b/.test(value))
      return "drinking-more-water";
    if (/\b(accident|bathroom|toilet|stool|poop|strain)\b/.test(value))
      return "bathroom-accidents";
    return "less-interest-in-life";
  };
  const updateAccountLinks = () => {
    const account = getAccount();
    document.querySelectorAll("[data-account-link]").forEach((link) => {
      link.textContent = account?.petName ? account.petName : "Log in";
      link.setAttribute(
        "aria-label",
        account?.petName
          ? `Open ${account.petName}'s profile`
          : "Log in or create a dog profile",
      );
    });
    document.querySelectorAll("[data-account-create]").forEach((link) => {
      link.hidden = Boolean(account?.email && account?.petName);
    });
  };

  const accountForm = document.querySelector("[data-account-form]");
  const accountCurrent = document.querySelector("[data-account-current]");
  const accountSummary = document.querySelector(
    "[data-account-profile-summary]",
  );
  const accountNote = document.querySelector("[data-account-note]");
  const accountFormTitle = document.querySelector("[data-account-form-title]");
  const accountSubmit = document.querySelector("[data-account-submit]");
  const accountEditButton = document.querySelector("[data-account-edit]");
  const lessonLibraryStep = document.querySelector(
    ".account-scene-media ol li:nth-child(3)",
  );
  if (lessonLibraryStep)
    lessonLibraryStep.textContent = "Keep public and private lessons here";
  const privateLessonsList = document.querySelector(
    "[data-private-lessons-list]",
  );
  const privateLessonsEmpty = document.querySelector(
    "[data-private-lessons-empty]",
  );
  let publicLessonsList = document.querySelector("[data-public-lessons-list]");
  let publicLessonsEmpty = document.querySelector("[data-public-lessons-empty]");
  let publicLessonsNote = document.querySelector("[data-public-lessons-note]");
  if (accountCurrent && !publicLessonsList) {
    const section = document.createElement("section");
    section.className = "account-private-lessons account-public-lessons";
    const sectionHeader = document.createElement("header");
    const sectionHeading = document.createElement("h2");
    sectionHeading.textContent = "My public Care Circle lessons";
    const sectionDescription = document.createElement("p");
    sectionDescription.textContent =
      "Public posts created in this browser appear here. Delete any post whenever you choose.";
    sectionHeader.append(sectionHeading, sectionDescription);
    publicLessonsList = document.createElement("div");
    publicLessonsList.dataset.publicLessonsList = "";
    publicLessonsEmpty = document.createElement("p");
    publicLessonsEmpty.dataset.publicLessonsEmpty = "";
    publicLessonsEmpty.textContent = "No public lessons yet.";
    publicLessonsNote = document.createElement("p");
    publicLessonsNote.className = "form-note";
    publicLessonsNote.dataset.publicLessonsNote = "";
    publicLessonsNote.setAttribute("role", "status");
    publicLessonsNote.setAttribute("aria-live", "polite");
    section.append(
      sectionHeader,
      publicLessonsList,
      publicLessonsEmpty,
      publicLessonsNote,
    );
    const privateSection = accountCurrent.querySelector(
      ".account-private-lessons",
    );
    accountCurrent.insertBefore(section, privateSection || null);
  }
  const googleSigninButton = document.querySelector("[data-google-signin]");
  const googleSigninStatus = document.querySelector("[data-google-status]");
  const firstActionDialog = document.querySelector("[data-first-action-dialog]");
  const firstActionClose = document.querySelector("[data-first-action-close]");
  const petPhotoInput = accountForm?.querySelector(
    "[data-pet-photo-input], [name='petPhoto']",
  );
  const petPhotoNodes = [
    ...document.querySelectorAll(
      "[data-pet-photo-preview], [data-account-pet-photo]",
    ),
  ];
  let pendingPetPhotoDataUrl = getAccount()?.petPhotoDataUrl || "";
  let editingAccount = false;
  const publishProfileQuestion = async (
    account,
    question,
    questionImageDataUrl = "",
    visibility = "private",
  ) => {
    const cleanQuestion = String(question || "")
      .trim()
      .slice(0, 500);
    if (!account || !cleanQuestion) return "";
    const slug = selectLessonSlug(cleanQuestion);
    const lessonId =
      globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const publicQuestion = {
      ...account,
      id: lessonId,
      ownerKey: normalizedOwnerKey(account.email),
      question: cleanQuestion,
      slug,
      questionImageDataUrl,
      visibility: visibility === "public" ? "public" : "private",
      createdAt: new Date().toISOString(),
    };
    if (!writeStoredJson(publicQuestionStorageKey, publicQuestion)) return "";
    if (publicQuestion.visibility === "public") {
      const previous = getPublicLessons().filter(
        (lesson) => lesson?.id !== lessonId,
      );
      if (
        !writeStoredJson(
          publicLessonsStorageKey,
          [publicQuestion, ...previous].slice(0, 100),
        )
      )
        return "";
    } else {
      const previous = getPrivateLessons().filter(
        (lesson) => lesson?.id !== lessonId,
      );
      if (
        !writeStoredJson(
          privateLessonStorageKey,
          [publicQuestion, ...previous].slice(0, 100),
        )
      )
        return "";
    }
    await notifyWoafMeowOwner(
      publicQuestion.visibility === "public"
        ? "public_care_lesson_created"
        : "private_care_lesson_created",
      account,
      {
        lesson_id: lessonId,
        lesson_slug: slug,
        visibility: publicQuestion.visibility,
        has_photo: questionImageDataUrl ? "yes" : "no",
      },
    );
    return slug;
  };
  const accountNext = new URLSearchParams(window.location.search).get("next");
  if (accountSubmit && accountNext === "health")
    accountSubmit.textContent = "Save profile and open Health Timeline →";
  googleSigninButton?.addEventListener("click", () => {
    if (googleSigninStatus) {
      googleSigninStatus.textContent =
        "Secure Google sign-in is being connected. You can create your account now with the Gmail address above.";
    }
    accountForm?.querySelector('[name="email"]')?.focus();
  });
  firstActionClose?.addEventListener("click", () => firstActionDialog?.close());
  firstActionDialog?.addEventListener("click", (event) => {
    if (event.target === firstActionDialog) firstActionDialog.close();
  });
  const renderPetPhoto = (dataUrl, petName = "") => {
    petPhotoNodes.forEach((node) =>
      renderStoredImage(
        node,
        dataUrl,
        petName ? `${petName}'s profile photo` : "Dog profile photo",
      ),
    );
  };
  const renderPrivateLessons = () => {
    if (!privateLessonsList || !privateLessonsEmpty) return;
    const lessons = getPrivateLessons().filter(
      (lesson) => lesson?.visibility === "private" && lesson?.question,
    );
    privateLessonsList.replaceChildren();
    privateLessonsEmpty.hidden = lessons.length > 0;
    lessons.forEach((lesson) => {
      const link = document.createElement("a");
      link.href = `/care-circle/${lesson.slug}/`;
      link.dataset.privateLessonId = lesson.id || "";
      const copy = document.createElement("strong");
      copy.textContent = lesson.question;
      const meta = document.createElement("span");
      const created = new Date(lesson.createdAt || "");
      meta.textContent = Number.isNaN(created.getTime())
        ? "Private lesson"
        : `Private · ${new Intl.DateTimeFormat("en", {
            year: "numeric",
            month: "short",
            day: "numeric",
          }).format(created)}`;
      link.append(copy, meta);
      link.addEventListener("click", (event) => {
        event.preventDefault();
        if (!writeStoredJson(publicQuestionStorageKey, lesson)) return;
        window.location.assign(link.href);
      });
      privateLessonsList.append(link);
    });
  };
  const renderPublicLessons = () => {
    if (!publicLessonsList || !publicLessonsEmpty) return;
    const lessons = getPublicLessons().filter(
      (lesson) =>
        lesson?.visibility === "public" &&
        lesson?.question &&
        lessonBelongsToAccount(lesson),
    );
    publicLessonsList.replaceChildren();
    publicLessonsEmpty.hidden = lessons.length > 0;
    lessons.forEach((lesson) => {
      const row = document.createElement("div");
      row.className = "account-public-lesson-row";
      const link = document.createElement("a");
      link.href = `/care-circle/${lesson.slug}/`;
      link.dataset.publicLessonId = lesson.id || "";
      const copy = document.createElement("strong");
      copy.textContent = lesson.question;
      const meta = document.createElement("span");
      const created = new Date(lesson.createdAt || "");
      meta.textContent = Number.isNaN(created.getTime())
        ? "Public post"
        : `Public · ${new Intl.DateTimeFormat("en", {
            year: "numeric",
            month: "short",
            day: "numeric",
          }).format(created)}`;
      link.append(copy, meta);
      link.addEventListener("click", (event) => {
        event.preventDefault();
        if (!writeStoredJson(publicQuestionStorageKey, lesson)) return;
        window.location.assign(link.href);
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "text-button danger";
      remove.dataset.deletePublicLesson = lesson.id || "";
      remove.textContent = "Delete post";
      remove.addEventListener("click", async () => {
        if (
          !window.confirm(
            "Delete this public Care Circle post? This removes the post and its tailored lesson from this browser.",
          )
        )
          return;
        if (!(await removePublicLesson(lesson.id))) {
          if (publicLessonsNote)
            publicLessonsNote.textContent =
              "This post could not be deleted. Please try again.";
          return;
        }
        if (publicLessonsNote)
          publicLessonsNote.textContent = "Your public post was deleted.";
        renderPublicLessons();
      });
      row.append(link, remove);
      publicLessonsList.append(row);
    });
  };
  petPhotoInput?.addEventListener("change", async () => {
    const file = petPhotoInput.files?.[0];
    if (!file) return;
    if (accountNote) accountNote.textContent = "Preparing photo…";
    try {
      pendingPetPhotoDataUrl = await readImageFile(file, {
        maxBytes: 8 * 1024 * 1024,
        maxDimension: 720,
        quality: 0.82,
      });
      renderPetPhoto(
        pendingPetPhotoDataUrl,
        accountForm?.elements.namedItem("petName")?.value || "",
      );
      if (accountNote) accountNote.textContent = "Photo ready to save.";
    } catch (error) {
      petPhotoInput.value = "";
      if (accountNote)
        accountNote.textContent =
          error instanceof Error ? error.message : "This image could not be read.";
    }
  });
  accountForm
    ?.querySelectorAll('[name="conditions"][type="checkbox"]')
    .forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        const choices = [
          ...accountForm.querySelectorAll(
            '[name="conditions"][type="checkbox"]',
          ),
        ];
        if (checkbox.value === "None known" && checkbox.checked) {
          choices.forEach((choice) => {
            if (choice !== checkbox) choice.checked = false;
          });
        } else if (checkbox.checked) {
          const none = choices.find((choice) => choice.value === "None known");
          if (none) none.checked = false;
        }
        const conditionError = accountForm.querySelector(
          "[data-condition-error]",
        );
        if (conditionError) conditionError.textContent = "";
      });
    });
  const renderAccount = () => {
    const account = getAccount();
    updateAccountLinks();
    renderPetPhoto(account?.petPhotoDataUrl || "", account?.petName || "");
    if (!accountForm || !accountCurrent || !accountSummary) return;
    accountCurrent.hidden = !account || editingAccount;
    accountForm.hidden = Boolean(account) && !editingAccount;
    if (accountFormTitle)
      accountFormTitle.textContent = editingAccount
        ? "Edit your care profile"
        : "Create your care profile";
    accountSummary.replaceChildren();
    renderPublicLessons();
    renderPrivateLessons();
    if (!account) return;
    [
      ["Owner", account.ownerName || "Not shared"],
      ["Email", account.email],
      ["Dog", `${account.petName} · ${account.petAge} · ${account.breed}`],
      ["Weight range", account.weightRange || "Not shared"],
      ["Owner-shared conditions", account.conditions],
      ["Medicines or recent changes", account.medications || "None shared"],
    ].forEach(([term, description]) => {
      const row = document.createElement("div");
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = term;
      dd.textContent = description;
      row.append(dt, dd);
      accountSummary.append(row);
    });
  };
  const populateAccountForm = (account) => {
    if (!accountForm || !account) return;
    pendingPetPhotoDataUrl = account.petPhotoDataUrl || "";
    renderPetPhoto(pendingPetPhotoDataUrl, account.petName || "");
    [
      "ownerName",
      "email",
      "petName",
      "petAge",
      "weightRange",
      "breedDetails",
      "conditionDetails",
      "medications",
    ].forEach((name) => {
      const field = accountForm.elements.namedItem(name);
      if (field) field.value = account[name] || "";
    });
    const breedField = accountForm.elements.namedItem("breed");
    if (breedField instanceof HTMLSelectElement) {
      const savedSelection = String(
        account.breedSelection || account.breed || "",
      );
      const available = [...breedField.options].some(
        (option) => option.value === savedSelection,
      );
      breedField.value = available
        ? savedSelection
        : "Breed not listed — describe below";
      if (!available && !account.breedDetails) {
        const details = accountForm.elements.namedItem("breedDetails");
        if (details) details.value = account.breed || "";
      }
    }
    const savedConditions = Array.isArray(account.conditionSelections)
      ? account.conditionSelections
      : String(account.conditions || "")
          .split(/[,;\n]+/)
          .map((item) => item.trim())
          .filter(Boolean);
    accountForm
      .querySelectorAll('[name="conditions"][type="checkbox"]')
      .forEach((checkbox) => {
        const exact = savedConditions.includes(checkbox.value);
        const arthritis =
          checkbox.value === "Arthritis or joint pain" &&
          savedConditions.some((value) => /arthritis|joint pain/i.test(value));
        const none =
          checkbox.value === "None known" &&
          savedConditions.some((value) => /^(none|none known)$/i.test(value));
        checkbox.checked = exact || arthritis || none;
      });
  };
  accountEditButton?.addEventListener("click", () => {
    const account = getAccount();
    if (!account) return;
    editingAccount = true;
    populateAccountForm(account);
    renderAccount();
    accountForm?.querySelector('[name="ownerName"]')?.focus();
  });
  accountForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!accountForm.reportValidity()) return;
    const formData = new FormData(accountForm);
    const values = Object.fromEntries(formData.entries());
    const conditionSelections = formData
      .getAll("conditions")
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    if (!conditionSelections.length) {
      const conditionError = accountForm.querySelector(
        "[data-condition-error]",
      );
      if (conditionError)
        conditionError.textContent =
          "Choose at least one condition, or choose None known.";
      accountForm
        .querySelector('[name="conditions"][type="checkbox"]')
        ?.focus();
      return;
    }
    const breedSelection = String(values.breed || "")
      .trim()
      .slice(0, 120);
    const breedDetails = String(values.breedDetails || "")
      .trim()
      .slice(0, 120);
    const conditionDetails = String(values.conditionDetails || "")
      .trim()
      .slice(0, 160);
    const conditionSummary = conditionSelections
      .map((condition) =>
        condition === "Other diagnosed condition" && conditionDetails
          ? `Other diagnosed condition: ${conditionDetails}`
          : condition,
      )
      .join("; ");
    const previousAccount = getAccount();
    const account = {
      ownerName: String(values.ownerName || "")
        .trim()
        .slice(0, 100),
      email: String(values.email || "")
        .trim()
        .slice(0, 254),
      petName: String(values.petName || "")
        .trim()
        .slice(0, 80),
      petAge: String(values.petAge || "")
        .trim()
        .slice(0, 40),
      breedSelection,
      breedDetails,
      breed: breedDetails
        ? `${breedSelection} — ${breedDetails}`.slice(0, 240)
        : breedSelection,
      weightRange: String(values.weightRange || "")
        .trim()
        .slice(0, 80),
      conditionSelections,
      conditionDetails,
      conditions: conditionSummary.slice(0, 360),
      medications: String(values.medications || "")
        .trim()
        .slice(0, 360),
      petPhotoDataUrl:
        pendingPetPhotoDataUrl || previousAccount?.petPhotoDataUrl || "",
    };
    if (!writeStoredJson(accountStorageKey, account)) {
      if (accountNote)
        accountNote.textContent =
          "This browser blocked profile storage. Please allow site storage and try again.";
      return;
    }
    pendingPetPhotoDataUrl = account.petPhotoDataUrl;
    await notifyWoafMeowOwner(
      previousAccount ? "care_account_updated" : "care_account_created",
      account,
      {
        account_state: previousAccount ? "updated" : "created",
        pet_age: account.petAge,
        breed: account.breed,
      },
    );
    editingAccount = false;
    renderAccount();
    if (accountForm.matches("[data-home-account-form]")) {
      const pendingQuestion = String(accountForm.dataset.pendingQuestion || "")
        .trim()
        .slice(0, 500);
      const target = new URL("/care-circle/", window.location.origin);
      if (pendingQuestion) target.searchParams.set("q", pendingQuestion);
      target.hash = "ask";
      window.location.assign(target.href);
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const question = (params.get("q") || "").trim().slice(0, 500);
    if (params.get("next") === "ask") {
      const target = new URL("/care-circle/", window.location.origin);
      if (question) target.searchParams.set("q", question);
      target.hash = "ask";
      window.location.assign(target.href);
      return;
    }
    if (params.get("next") === "health") {
      window.location.assign("/health-timeline/");
      return;
    }
    if (accountNote) accountNote.textContent = "Profile saved.";
  });
  document
    .querySelector("[data-account-signout]")
    ?.addEventListener("click", () => {
      try {
        localStorage.removeItem(accountStorageKey);
        localStorage.removeItem(publicQuestionStorageKey);
        localStorage.removeItem(publicLessonsStorageKey);
        localStorage.removeItem(privateLessonStorageKey);
      } catch {
        // The current screen still resets even if storage access changes.
      }
      accountForm?.reset();
      pendingPetPhotoDataUrl = "";
      editingAccount = false;
      renderAccount();
    });
  renderAccount();

  document
    .querySelectorAll("[data-home-question-form]")
    .forEach((questionForm) => questionForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      const question = String(new FormData(form).get("question") || "")
        .trim()
        .slice(0, 500);
      const account = getAccount();
      if (account) {
        const slug = await publishProfileQuestion(account, question);
        if (slug) {
          window.location.assign(`/care-circle/${slug}/`);
          return;
        }
        form.querySelector("input, textarea")?.focus();
        return;
      }
      if (firstActionDialog?.showModal && accountForm) {
        accountForm.dataset.pendingQuestion = question;
        firstActionDialog.showModal();
        window.setTimeout(
          () => accountForm.querySelector('[name="ownerName"]')?.focus(),
          0,
        );
        return;
      }
      const target = new URL("/account/", window.location.origin);
      target.searchParams.set("q", question);
      target.searchParams.set("next", "ask");
      window.location.assign(target.href);
    }));

  const accountGate = document.querySelector("[data-account-gate]");
  const askForm = document.querySelector("[data-account-ask-form]");
  const questionImageInput =
    askForm?.querySelector(
      "[data-question-image-input], [name='questionImage']",
    ) || document.querySelector("[data-question-image-input]");
  const questionImageNodes = [
    ...document.querySelectorAll(
      "[data-question-image-preview], [data-public-question-image], [data-tailored-question-image]",
    ),
  ];
  const questionImageRemove = document.querySelector(
    "[data-question-image-remove]",
  );
  const isQuestionComposer = Boolean(askForm && questionImageInput);
  const storedPublicQuestion = getPublicQuestion();
  let pendingQuestionImageDataUrl = isQuestionComposer
    ? ""
    : storedPublicQuestion?.questionImageDataUrl || "";
  const renderQuestionImage = (dataUrl, petName = "") => {
    questionImageNodes.forEach((node) =>
      renderStoredImage(
        node,
        dataUrl,
        petName ? `${petName}'s owner-shared care photo` : "Owner-shared care photo",
      ),
    );
    if (questionImageRemove) questionImageRemove.hidden = !dataUrl;
  };
  renderQuestionImage(
    pendingQuestionImageDataUrl,
    storedPublicQuestion?.petName || "",
  );
  const resetQuestionComposerImage = () => {
    if (!isQuestionComposer) return;
    pendingQuestionImageDataUrl = "";
    questionImageInput.value = "";
    renderQuestionImage("", getAccount()?.petName || "");
  };
  resetQuestionComposerImage();
  window.addEventListener("pageshow", resetQuestionComposerImage);
  questionImageInput?.addEventListener("change", async () => {
    const file = questionImageInput.files?.[0];
    if (!file) return;
    const note = askForm?.querySelector("[data-account-ask-note]");
    if (note) note.textContent = "Preparing photo…";
    try {
      pendingQuestionImageDataUrl = await readImageFile(file, {
        maxBytes: 10 * 1024 * 1024,
        maxDimension: 960,
        quality: 0.78,
      });
      renderQuestionImage(
        pendingQuestionImageDataUrl,
        getAccount()?.petName || "",
      );
      if (note) note.textContent = "Photo ready to include.";
    } catch (error) {
      questionImageInput.value = "";
      pendingQuestionImageDataUrl = "";
      renderQuestionImage("", getAccount()?.petName || "");
      if (note)
        note.textContent =
          error instanceof Error ? error.message : "This image could not be read.";
    }
  });
  questionImageRemove?.addEventListener("click", () => {
      pendingQuestionImageDataUrl = "";
      if (questionImageInput) questionImageInput.value = "";
      renderQuestionImage("", getAccount()?.petName || "");
    });
  if (accountGate && askForm) {
    const account = getAccount();
    const questionField = askForm.querySelector('[name="question"]');
    const askNote = askForm.querySelector("[data-account-ask-note]");
    const askParams = new URLSearchParams(window.location.search);
    const askRequested =
      askParams.get("ask") === "1" || window.location.hash === "#ask";
    const requestedQuestion = (
      new URLSearchParams(window.location.search).get("q") || ""
    )
      .trim()
      .slice(0, 500);
    if (questionField && requestedQuestion)
      questionField.value = requestedQuestion;
    askForm.hidden = false;
    if (!account) {
      accountGate.hidden = false;
      const summary = askForm.querySelector("[data-active-pet-summary]");
      if (summary)
        summary.textContent =
          "Ask now. You will create your dog's one-time care profile before the lesson is published.";
    } else {
      accountGate.hidden = true;
      askForm.hidden = false;
      const summary = askForm.querySelector("[data-active-pet-summary]");
      if (summary)
        summary.textContent = `${account.petName} · ${account.petAge} · ${account.breed} · ${account.conditions}`;
    }
    if (askRequested && !askForm.hidden) {
      window.requestAnimationFrame(() => {
        askForm.scrollIntoView({ behavior: "smooth", block: "center" });
        questionField?.focus({ preventScroll: true });
      });
    }
    askForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!askForm.reportValidity()) return;
      const values = Object.fromEntries(new FormData(askForm).entries());
      const question = String(values.question || "")
        .trim()
        .slice(0, 500);
      if (!account) {
        const target = new URL("/account/", window.location.origin);
        target.searchParams.set("q", question);
        target.searchParams.set("next", "ask");
        window.location.assign(target.href);
        return;
      }
      const slug = await publishProfileQuestion(
        account,
        question,
        pendingQuestionImageDataUrl,
        values.lessonVisibility,
      );
      if (!slug) {
        if (askNote)
          askNote.textContent =
            "This browser could not save the question. Please allow site storage and try again.";
        return;
      }
      window.location.assign(`/care-circle/${slug}/`);
    });
  }

  const buildTailoredLesson = (profile, slug) => {
    const pet = profile.petName;
    const age = profile.petAge.toLocaleLowerCase();
    const breed = profile.breed;
    const conditions = profile.conditions || "no known condition shared";
    const medicines = profile.medications || "no medicine change shared";
    const question = profile.question;
    const clinicalContext = (() => {
      const value = `${conditions} ${medicines}`.toLocaleLowerCase();
      if (/arthritis|joint|hip|spine|mobility/.test(value))
        return `Because ${conditions} is already part of ${pet}'s history, compare effort, surfaces and recovery without assuming every new change has the same cause.`;
      if (/kidney|renal/.test(value))
        return `Because kidney disease is shared, keep water, urine, appetite and energy in the same record and contact the veterinary team about a sustained change.`;
      if (/dental|tooth|teeth|mouth/.test(value))
        return `Because a mouth or dental problem is shared, record chewing, dropping food, swallowing and interest in softer versus familiar textures.`;
      if (/diabet|insulin/.test(value))
        return `Because diabetes or insulin is shared, a change in eating, drinking, urine or energy deserves prompt advice from the prescribing team.`;
      if (/steroid|prednisone|medicin|dose|drug/.test(value))
        return `Because a medicine change is shared, record the dose timing beside the new pattern and contact the prescribing team before changing it.`;
      if (/cognitive|confus|dementia/.test(value))
        return `Because cognitive change is shared, record time of day, orientation, sleep, toileting and what helps ${pet} settle.`;
      return `No known diagnosis explains this by itself. Describe the new pattern clearly and let the veterinary team decide what needs evaluation.`;
    })();
    const shared = {
      mobility: [
        [
          `For ${pet}, a ${age} ${breed}, start with the exact first rise you described: “${question}” ${clinicalContext}`,
          [
            `Watch one ordinary rise after a familiar rest—do not repeat it for a test.`,
            `Note the surface, pause before standing, first 10–15 steps and time to loosen.`,
            `Record whether a foot slips, a limb is protected or the usual route is avoided.`,
          ],
        ],
        [
          `Make ${pet}'s next route easier while keeping the observation useful.`,
          [
            `Add traction from the resting place to the first destination.`,
            `Shorten the route and block jumping or slippery turns.`,
            `Change one detail at a time and note whether effort or recovery changes.`,
          ],
        ],
        [
          `Prepare a mobility call around ${pet}'s real pattern, ${conditions}, and ${medicines}.`,
          [
            `Bring a short natural video and the dates the change occurred.`,
            `List the surface, pause, steps, recovery and anything that helped.`,
            `Ask what should be examined now and which change should trigger faster care.`,
          ],
        ],
      ],
      night: [
        [
          `For ${pet}, map the first nighttime event instead of treating every wake-up as the same problem. ${clinicalContext}`,
          [
            `Record bedtime and the first wake time.`,
            `Name what happens first: pacing, panting, vocalizing, drinking, toileting or repositioning.`,
            `Note breathing, orientation and what helps ${pet} settle again.`,
          ],
        ],
        [
          `Make tonight calmer for ${pet} without hiding the sequence you need to understand.`,
          [
            `Keep water and a short, non-slip bathroom route available.`,
            `Use gentle light on the familiar path and keep the sleep area comfortable.`,
            `Change one environmental detail, then record whether wake-ups or settling change.`,
          ],
        ],
        [
          `Bring the seven-night pattern, ${conditions}, and ${medicines} to ${pet}'s care team.`,
          [
            `List wake times and the first behavior at each wake.`,
            `Include breathing, urine, thirst, pain behavior and daytime sleep.`,
            `Ask which causes need examination and what should not wait.`,
          ],
        ],
      ],
      appetite: [
        [
          `For ${pet}, separate eating less from trouble chewing, nausea or a changed food preference. ${clinicalContext}`,
          [
            `Measure what was offered and what remained.`,
            `Watch approach, sniffing, chewing, dropping food, swallowing and walking away.`,
            `Pair the meal note with weight, vomiting, stool, water and energy.`,
          ],
        ],
        [
          `Protect ${pet}'s access to food while arranging the right next step.`,
          [
            `Keep familiar food unless the veterinary team has given another plan.`,
            `Use an easy-to-reach bowl and a calm feeding place.`,
            `Do not pressure-feed or make several diet changes at once.`,
          ],
        ],
        [
          `Prepare the appetite call with quantities, timing, ${conditions}, and ${medicines}.`,
          [
            `Bring a two- or three-day meal record.`,
            `Include mouth signs, nausea signs, weight change and water intake.`,
            `Ask what needs examination before supplements or a major diet change.`,
          ],
        ],
      ],
      water: [
        [
          `For ${pet}, measure drinking together with urine—not as an isolated bowl count. ${clinicalContext}`,
          [
            `Measure one ordinary 24-hour period if it is safe and practical.`,
            `Record refill amounts, shared bowls and unusual drinking locations.`,
            `Pair it with urine frequency, appetite, weight, energy and medicine timing.`,
          ],
        ],
        [
          `Keep fresh water available while making bathroom access easier for ${pet}.`,
          [
            `Do not restrict water to reduce accidents.`,
            `Add a closer bowl and a shorter, well-lit bathroom route.`,
            `Record whether thirst is new, sustained or tied to a medicine change.`,
          ],
        ],
        [
          `Bring the water-and-urine timeline, ${conditions}, and ${medicines} to the veterinary team.`,
          [
            `State the first day the pattern changed.`,
            `List estimated intake, urine frequency and accidents.`,
            `Ask how soon testing is needed and which signs require urgent care.`,
          ],
        ],
      ],
      bathroom: [
        [
          `For ${pet}, identify whether the first change is urgency, increased volume, pain, posture or route difficulty. ${clinicalContext}`,
          [
            `Record time, location, amount and posture.`,
            `Note straining, blood, vocalizing, confusion or trouble reaching the door.`,
            `Pair accidents with water, stool, medicines, mobility and sleep.`,
          ],
        ],
        [
          `Make the next bathroom trip easier and more dignified for ${pet}.`,
          [
            `Offer more frequent access on a short, non-slip route.`,
            `Use gentle lighting and keep the exit unobstructed.`,
            `Clean calmly and avoid punishment; the pattern is information.`,
          ],
        ],
        [
          `Prepare the bathroom call around frequency, output, ${conditions}, and ${medicines}.`,
          [
            `Bring dates and a simple urine or stool log.`,
            `Include straining, blood, pain, thirst and mobility changes.`,
            `Ask which tests are appropriate and what means ${pet} should be seen sooner.`,
          ],
        ],
      ],
      daily: [
        [
          `For ${pet}, name the exact routine that changed instead of calling it “slowing down.” ${clinicalContext}`,
          [
            `Choose one familiar routine: greeting, meal, walk, play or family time.`,
            `Record whether ${pet} starts, joins, finishes or avoids it.`,
            `Note pain behavior, confusion, hearing or vision clues and time of day.`,
          ],
        ],
        [
          `Offer ${pet} a lower-effort version of the routine and watch the choice.`,
          [
            `Shorten the activity and improve traction or access.`,
            `Keep the invitation familiar and allow ${pet} to opt out.`,
            `Record whether connection, comfort or recovery improves.`,
          ],
        ],
        [
          `Bring the whole daily-life pattern, ${conditions}, and ${medicines} to the care team.`,
          [
            `List which routines changed and when.`,
            `Include sleep, appetite, bathroom, pain and orientation changes.`,
            `Ask what may be treatable and what home support fits ${pet} now.`,
          ],
        ],
      ],
      breathing: [
        [
          `For ${pet}, contact the veterinary team before building a breathing record. ${clinicalContext}`,
          [
            `Call today for a new or repeated cough at rest and report whether breathing looks harder or faster.`,
            `Seek emergency care now for breathing difficulty, blue, gray or pale gums, collapse, inability to settle or severe distress.`,
            `Do not wait for a complete log or recreate the symptom before calling.`,
          ],
        ],
        [
          `If ${pet} is stable and the veterinary team agrees, add one brief natural observation.`,
          [
            `Move ${pet} to a cool, quiet space with easy access to water.`,
            `Avoid exercise, neck pressure and repeated breathing tests.`,
            `Take a short natural video or resting-breath count only if doing so does not delay care.`,
          ],
        ],
        [
          `Share the breathing timeline, ${conditions}, and ${medicines} clearly.`,
          [
            `Give the resting rate, trigger, duration and recovery time.`,
            `Include coughing, faintness, appetite, sleep and medicine timing.`,
            `Ask whether ${pet} needs same-day or emergency assessment.`,
          ],
        ],
      ],
      weight: [
        [
          `For ${pet}, confirm the weight direction and timeline instead of relying on appearance alone. ${clinicalContext}`,
          [
            `Use the same scale and similar time of day when practical.`,
            `Record food eaten, treats, water, stool and activity beside each weight.`,
            `Note muscle loss, abdominal change, swelling or clothing and harness fit.`,
          ],
        ],
        [
          `Keep ${pet}'s routine steady while you collect a short, useful trend.`,
          [
            `Do not make a major diet change from one measurement.`,
            `Measure portions for several days and record what is actually eaten.`,
            `Flag vomiting, diarrhea, thirst, pain or reduced activity.`,
          ],
        ],
        [
          `Bring dated weights, intake, ${conditions}, and ${medicines} to the care team.`,
          [
            `State how much weight changed and over what period.`,
            `Include appetite, bathroom, breathing and energy changes.`,
            `Ask what examination or testing should come next.`,
          ],
        ],
      ],
      medicine: [
        [
          `For ${pet}, place the new pattern on the medicine timeline. ${clinicalContext}`,
          [
            `Record the medicine name, dose, time given and first sign noticed.`,
            `Note missed doses, supplements and any other recent prescription change.`,
            `Track appetite, water, bathroom, sleep, energy and balance.`,
          ],
        ],
        [
          `Keep ${pet} safe without changing the prescription on your own.`,
          [
            `Follow the current label unless the prescribing team advises otherwise.`,
            `Prevent falls and keep food, water and bathroom access easy.`,
            `Save packaging and take a photo of the label for the call.`,
          ],
        ],
        [
          `Contact the prescribing team with the exact dose-to-symptom sequence.`,
          [
            `Share dose, time, symptom onset, duration and what improved it.`,
            `List every medicine and supplement ${pet} receives.`,
            `Ask whether the next dose or an examination needs to change.`,
          ],
        ],
      ],
      skin: [
        [
          `For ${pet}, make the skin or lump record measurable. ${clinicalContext}`,
          [
            `Photograph it beside a ruler in the same light and position.`,
            `Record location, size, color, texture, warmth, pain and discharge.`,
            `Note licking, scratching, appetite, energy and how quickly it changed.`,
          ],
        ],
        [
          `Protect the area while avoiding treatments that could hide the pattern.`,
          [
            `Prevent licking or scratching if it can be done comfortably.`,
            `Keep the area clean and dry without squeezing a lump.`,
            `Do not use human creams unless the veterinary team approves them.`,
          ],
        ],
        [
          `Bring the dated photo sequence, ${conditions}, and ${medicines} to the visit.`,
          [
            `Share size changes and any bleeding, pain or discharge.`,
            `List new foods, products, medicines and outdoor exposures.`,
            `Ask how soon the change should be examined or sampled.`,
          ],
        ],
      ],
      senses: [
        [
          `For ${pet}, separate a vision or hearing change from pain, balance or confusion. ${clinicalContext}`,
          [
            `Record the room, lighting, sound and exact response.`,
            `Note bumping, startling, circling, head tilt, eye change or discharge.`,
            `Compare familiar cues without repeatedly testing or frightening ${pet}.`,
          ],
        ],
        [
          `Make familiar routes easier while ${pet}'s change is evaluated.`,
          [
            `Keep furniture, bowls and sleeping places predictable.`,
            `Use traction, gentle lighting and calm touch or voice cues.`,
            `Block stairs, pools and other fall risks.`,
          ],
        ],
        [
          `Share onset, side affected, ${conditions}, and ${medicines} with the care team.`,
          [
            `Bring a short video of the natural behavior.`,
            `Include balance, eye appearance, pain, sleep and orientation changes.`,
            `Ask which sudden signs require urgent examination.`,
          ],
        ],
      ],
      dental: [
        [
          `For ${pet}, record whether the first problem is approach, chewing, swallowing or mouth pain. ${clinicalContext}`,
          [
            `Watch one normal meal without opening or probing the mouth.`,
            `Note dropping food, chewing on one side, drooling, odor, bleeding or pawing.`,
            `Record food texture, amount eaten and time needed.`,
          ],
        ],
        [
          `Make eating easier for ${pet} while arranging a dental assessment.`,
          [
            `Offer the familiar veterinary-approved food in an easy-to-reach bowl.`,
            `Avoid hard chews, bones and forceful mouth handling.`,
            `Keep water available and record whether drinking is also painful.`,
          ],
        ],
        [
          `Bring the meal pattern, mouth signs, ${conditions}, and ${medicines} to the team.`,
          [
            `State when eating changed and what textures are affected.`,
            `Include swelling, odor, bleeding, weight and energy changes.`,
            `Ask what pain relief and oral examination are appropriate.`,
          ],
        ],
      ],
    };
    const lessonKeys = {
      "slower-after-rest": "mobility",
      "restless-at-night": "night",
      "changes-in-appetite": "appetite",
      "drinking-more-water": "water",
      "bathroom-accidents": "bathroom",
      "less-interest-in-life": "daily",
      "new-cough-or-breathing-change": "breathing",
      "unexpected-weight-change": "weight",
      "after-a-medicine-change": "medicine",
      "new-lump-or-skin-change": "skin",
      "vision-or-hearing-change": "senses",
      "mouth-or-dental-pain": "dental",
    };
    const fourthPart = [
      `Know when ${pet}'s pattern should move from tracking to faster veterinary care.`,
      [
        `Contact the care team promptly when the change is sudden, persistent, painful or worsening.`,
        `Seek urgent care for trouble breathing, collapse, uncontrolled bleeding, repeated unproductive retching, inability to urinate or severe distress.`,
        `Share ${pet}'s timeline, photos and saved records so the team can triage the next step.`,
      ],
    ];
    return [...(shared[lessonKeys[slug]] || shared.daily), fourthPart];
  };

  const storedPersonalQuestion = getPublicQuestion();
  const currentCareProfile = getAccount();
  const currentProfileOwnsQuestion = lessonBelongsToAccount(
    storedPersonalQuestion,
    currentCareProfile,
  );
  if (
    storedPersonalQuestion?.visibility === "public" &&
    lessonBelongsToAccount(storedPersonalQuestion, currentCareProfile) &&
    !getPublicLessons().some(
      (lesson) => lesson?.id === storedPersonalQuestion.id,
    )
  ) {
    writeStoredJson(publicLessonsStorageKey, [
      storedPersonalQuestion,
      ...getPublicLessons(),
    ].slice(0, 100));
  }
  const personalQuestion = storedPersonalQuestion
    ? {
        ...storedPersonalQuestion,
        ...(currentProfileOwnsQuestion
          ? {
              ownerName:
                currentCareProfile.ownerName || storedPersonalQuestion.ownerName,
              petName:
                currentCareProfile.petName || storedPersonalQuestion.petName,
              petAge: currentCareProfile.petAge || storedPersonalQuestion.petAge,
              breed: currentCareProfile.breed || storedPersonalQuestion.breed,
              conditions:
                currentCareProfile.conditions ||
                storedPersonalQuestion.conditions,
              medications:
                currentCareProfile.medications ||
                storedPersonalQuestion.medications,
            }
          : {}),
      }
    : null;
  const lessonSlugMatch = currentPath.match(/^\/care-circle\/([^/]+)\/?$/);
  if (
    personalQuestion &&
    lessonSlugMatch?.[1] === personalQuestion.slug
  ) {
    const applyPersonalLessonContext = () => {
      const petName = String(personalQuestion.petName || "Your dog").trim();
      const petAge = String(personalQuestion.petAge || "Age not shared").trim();
      const breed = String(personalQuestion.breed || "Breed not shared").trim();
      const question = String(
        personalQuestion.question || "No current change shared",
      ).trim();
      const conditions =
        personalQuestion.conditions || "no known condition shared";
      const medicines =
        personalQuestion.medications || "no medicine change shared";
      document.querySelectorAll("[data-public-dog]").forEach((node) => {
        node.textContent = `${petName} · ${petAge} · ${breed}`;
      });
      document.querySelectorAll("[data-public-conditions]").forEach((node) => {
        node.textContent = conditions;
      });
      document.querySelectorAll("[data-public-change]").forEach((node) => {
        node.textContent = question;
      });
      document.querySelectorAll("[data-tailored-pet-name]").forEach((node) => {
        node.textContent = petName;
      });
      document.querySelectorAll("[data-tailored-context]").forEach((node) => {
        node.textContent = `${petName} is ${petAge.toLocaleLowerCase()}, a ${breed}, with ${conditions}; the owner reports ${question}.`;
      });
      renderQuestionImage(
        personalQuestion.questionImageDataUrl || "",
        petName,
      );
      const tailored = buildTailoredLesson(
        { ...personalQuestion, petName, petAge, breed, question },
        lessonSlugMatch[1],
      );
      document
        .querySelectorAll("[data-tailored-chapter-summary]")
        .forEach((summary, index) => {
          if (tailored[index]) summary.textContent = tailored[index][0];
        });
      document
        .querySelectorAll("[data-tailored-chapter-steps]")
        .forEach((list, index) => {
        const steps = tailored[index]?.[1] || [];
        list.replaceChildren(
          ...steps.map((step) => {
            const item = document.createElement("li");
            item.textContent = step;
            return item;
          }),
        );
        });
      document
        .querySelectorAll("[data-tailored-part], [data-tailored-part-summary]")
        .forEach((node) => {
        const partNumber = Number(
          node.dataset.tailoredPart || node.dataset.tailoredPartSummary,
        );
        const part = tailored[partNumber - 1];
        const target = node.matches("section, article, div")
          ? node.querySelector(
              "[data-tailored-part-summary], [data-tailored-chapter-summary]",
            )
          : node;
        if (part && target) target.textContent = part[0];
        });
      document.querySelectorAll("[data-tailored-part-steps]").forEach((list) => {
        const part = tailored[Number(list.dataset.tailoredPartSteps) - 1];
        if (!part) return;
        list.replaceChildren(
          ...part[1].map((step) => {
            const item = document.createElement("li");
            item.textContent = step;
            return item;
          }),
        );
      });
    };
    applyPersonalLessonContext();
    requestAnimationFrame(applyPersonalLessonContext);
    [80, 240, 600].forEach((delay) =>
      window.setTimeout(applyPersonalLessonContext, delay),
    );
    const ownerActions = document.querySelector(
      "[data-lesson-owner-actions]",
    );
    const deleteButton = ownerActions?.querySelector(
      "[data-delete-public-lesson]",
    );
    const deleteNote = ownerActions?.querySelector(
      "[data-delete-public-note]",
    );
    const canDelete =
      personalQuestion.visibility === "public" &&
      lessonBelongsToAccount(personalQuestion, currentCareProfile);
    if (ownerActions) ownerActions.hidden = !canDelete;
    if (canDelete && deleteButton) {
      deleteButton.addEventListener("click", async () => {
        if (
          !window.confirm(
            "Delete this public Care Circle post? This removes the post and its tailored lesson from this browser.",
          )
        )
          return;
        if (!(await removePublicLesson(personalQuestion.id))) {
          if (deleteNote)
            deleteNote.textContent =
              "This post could not be deleted. Please try again.";
          return;
        }
        window.location.assign("/care-circle/?deleted=1#public-lessons");
      });
    }
  }

  navigation?.querySelectorAll("a").forEach((link) => {
    const linkPath = new URL(link.href, window.location.href).pathname;
    if (linkPath !== "/" && currentPath.startsWith(linkPath)) {
      link.setAttribute("aria-current", "page");
    }
  });
})();

(() => {
  const root = document.querySelector("[data-health-root]");
  if (!root) return;

  const ACCOUNT_KEY = "woafmeow-account-v1";
  const LOG_PREFIX = "woafmeow-health-logs-v1:";
  const DATABASE_NAME = "woafmeow-health-v1";
  const DATABASE_VERSION = 1;
  const STORE_NAME = "records";
  const MAX_FILE_SIZE = 15 * 1024 * 1024;
  const TEXT_TYPES = new Set(["text/plain", "text/csv", "application/json"]);
  const supportedExtensions = /\.(pdf|txt|csv|jpe?g|png)$/i;
  const patternRules = [
    [
      "Mobility",
      /\b(stiff|limp|mobility|walk|stairs?|rise|rising|slip|joint|arthritis|osteoarthritis)\b/i,
    ],
    ["Sleep", /\b(sleep|night|restless|pacing|wake|waking)\b/i],
    ["Eating", /\b(food|eat|eating|appetite|chew|nausea|meal)\b/i],
    ["Drinking", /\b(water|drink|drinking|thirst|hydration)\b/i],
    [
      "Bathroom",
      /\b(urine|urinating|stool|bathroom|accident|strain|diarrhea|constipation)\b/i,
    ],
    ["Breathing", /\b(breath|breathing|cough|panting)\b/i],
    ["Pain or comfort", /\b(pain|sore|comfort|crying|tender)\b/i],
    [
      "Energy or connection",
      /\b(energy|tired|letharg|withdraw|interest|play)\b/i,
    ],
    [
      "Medicine response",
      /\b(medicine|medication|dose|tablet|capsule|prescription|side effect)\b/i,
    ],
    ["Weight", /\b(weight|weigh|pounds?|lbs?|kilograms?|kg)\b/i],
  ];
  const conditionRules = [
    ["arthritis", /\b(arthritis|osteoarthritis)\b/i],
    ["kidney disease", /\b(kidney disease|renal disease|renal failure)\b/i],
    ["diabetes", /\b(diabetes|diabetic)\b/i],
    ["heart disease", /\b(heart disease|cardiac disease|heart failure)\b/i],
    ["dental disease", /\b(dental disease|periodontal disease)\b/i],
    ["cognitive changes", /\b(cognitive dysfunction|dementia)\b/i],
    ["cancer", /\b(cancer|carcinoma|lymphoma|sarcoma|tumou?r)\b/i],
    ["allergy", /\b(allergy|allergic)\b/i],
    ["pancreatitis", /\bpancreatitis\b/i],
    ["hypothyroidism", /\bhypothyroidism\b/i],
    ["seizure", /\bseizures?\b/i],
  ];

  const gate = root.querySelector("[data-health-account-gate]");
  const workspace = root.querySelector("[data-health-workspace]");
  const recordForm = root.querySelector("[data-health-record-form]");
  const logForm = root.querySelector("[data-health-log-form]");
  const recordNote = root.querySelector("[data-health-record-note]");
  const logNote = root.querySelector("[data-health-log-note]");
  const timeline = root.querySelector("[data-health-records]");
  const empty = root.querySelector("[data-health-empty]");
  const mentionSummary = root.querySelector("[data-health-record-mentions]");
  const patternSummary = root.querySelector("[data-health-pattern-summary]");
  const weightSummary = root.querySelector("[data-health-weight-summary]");
  const shareForm = root.querySelector("[data-health-share-form]");
  const vetEmailField =
    root.querySelector("[data-health-vet-email]") ||
    shareForm?.querySelector("[name='vetEmail']");
  const vetNameField =
    root.querySelector("[data-health-vet-name]") ||
    shareForm?.querySelector("[name='vetName']");
  const shareNoteField =
    root.querySelector("[data-health-share-note]") ||
    shareForm?.querySelector("[name='shareNote']");
  const emailVetButton = root.querySelector(
    "[data-health-email-vet], [data-health-email-draft]",
  );
  const webShareButton = root.querySelector("[data-health-web-share]");
  const shareStatus = root.querySelector("[data-health-share-status]");
  const account = (() => {
    try {
      return JSON.parse(localStorage.getItem(ACCOUNT_KEY) || "null");
    } catch {
      return null;
    }
  })();

  gate.hidden = Boolean(account?.email && account?.petName);
  workspace.hidden = !account?.email || !account?.petName;
  if (!account?.email || !account?.petName) return;

  const petKey = `${String(account.email).trim().toLocaleLowerCase()}::${String(account.petName).trim().toLocaleLowerCase()}`;
  const logKey = `${LOG_PREFIX}${petKey}`;
  root.querySelectorAll("[data-health-pet-name]").forEach((node) => {
    node.textContent = account.petName;
  });
  root.querySelectorAll("[data-health-timeline-pet]").forEach((node) => {
    node.textContent = account.petName;
  });
  const today = new Date().toISOString().slice(0, 10);
  if (recordForm?.elements.recordDate)
    recordForm.elements.recordDate.value = today;
  if (logForm?.elements.logDate) logForm.elements.logDate.value = today;

  const readLogs = () => {
    try {
      const value = JSON.parse(localStorage.getItem(logKey) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  };
  const writeLogs = (logs) =>
    localStorage.setItem(logKey, JSON.stringify(logs));
  const makeId = () =>
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const formatDate = (value) => {
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime())
      ? value
      : new Intl.DateTimeFormat("en", {
          year: "numeric",
          month: "short",
          day: "numeric",
        }).format(date);
  };
  const splitProfileList = (value) =>
    String(value || "")
      .split(/[,;\n]+/)
      .map((item) => item.trim())
      .filter((item) => item && !/^(none|none known|n\/a)$/i.test(item));

  const openDatabase = () =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, {
            keyPath: "id",
          });
          store.createIndex("petKey", "petKey", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          request.error ||
            new Error("Health record storage could not be opened."),
        );
    });
  const recordTransaction = async (mode, operation) => {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      const request = operation(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error || new Error("Health record storage failed."));
      transaction.oncomplete = () => database.close();
      transaction.onerror = () =>
        reject(transaction.error || new Error("Health record storage failed."));
    });
  };
  const getRecords = async () => {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const index = transaction.objectStore(STORE_NAME).index("petKey");
      const request = index.getAll(petKey);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () =>
        reject(request.error || new Error("Health records could not be read."));
      transaction.oncomplete = () => database.close();
    });
  };

  const combinedText = (records, logs) =>
    [
      account.conditions,
      account.medications,
      ...records.flatMap((record) => [
        record.name,
        record.note,
        record.extractedText,
      ]),
      ...logs.flatMap((log) => [
        log.category,
        log.observation,
        log.medicineChange,
      ]),
    ]
      .filter(Boolean)
      .join(" ");

  const setShareStatus = (message, isError = false) => {
    if (!shareStatus) return;
    shareStatus.textContent = message;
    shareStatus.dataset.state = isError ? "error" : "success";
  };

  const buildVetReadySummary = (records, logs) => {
    const owner = String(account.ownerName || "Pet owner").trim();
    const vetName = String(vetNameField?.value || "").trim();
    const ownerNote = String(shareNoteField?.value || "").trim();
    const conditions = splitProfileList(account.conditions);
    const medicines = splitProfileList(account.medications);
    const patterns = patternRules
      .filter(([, rule]) => rule.test(combinedText(records, logs)))
      .map(([label]) => label);
    const datedLogs = [...logs].sort((left, right) =>
      String(right.date || "").localeCompare(String(left.date || "")),
    );
    const datedRecords = [...records].sort((left, right) =>
      String(right.date || "").localeCompare(String(left.date || "")),
    );
    const lines = [
      "WOAFMEOW VETERINARY CARE SUMMARY",
      vetName ? `Prepared for: ${vetName}` : "Prepared for veterinary review",
      `Prepared on: ${new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(new Date())}`,
      "",
      "1. PRIMARY CONCERN",
      ownerNote || "No primary question was added.",
      "",
      "2. PATIENT",
      `Name: ${account.petName}`,
      `Age: ${account.petAge || "Not shared"}`,
      `Breed or mix: ${account.breed || "Not shared"}`,
      `Weight range: ${account.weightRange || "Not shared"}`,
      `Owner: ${owner}`,
      `Owner email: ${account.email}`,
      "",
      "3. CONDITIONS, MEDICINES AND REPEATED PATTERNS",
      `Known conditions: ${conditions.join("; ") || "None shared"}`,
      `Medicines or recent changes: ${medicines.join("; ") || "None shared"}`,
      `Patterns across the timeline: ${patterns.join("; ") || "No repeated pattern identified yet"}`,
      "",
      "4. RECENT DATED OBSERVATIONS",
      ...(datedLogs.length
        ? datedLogs.map((log) => {
            const details = [
              log.weight
                ? `weight ${log.weight} ${log.weightUnit || "lb"}`
                : "",
              log.medicineChange
                ? `related change: ${log.medicineChange}`
                : "",
            ].filter(Boolean);
            return `- ${formatDate(log.date)} · ${log.category || "Other"} · ${log.severity || "Not rated"}: ${log.observation || "No observation entered"}${details.length ? ` (${details.join("; ")})` : ""}`;
          })
        : ["- No dated observations saved yet."]),
      "",
      "5. ATTACHED HEALTH RECORDS",
      ...(datedRecords.length
        ? datedRecords.map(
            (record) =>
              `- ${formatDate(record.date)} · ${record.type || "Other"}: ${record.name}${record.note ? ` — ${record.note}` : ""}`,
          )
        : ["- No records uploaded yet."]),
    ];
    lines.push(
      "",
      "6. REQUESTED NEXT STEP",
      "Please review the observations and attached records and advise which findings need an appointment, testing or a change in the current care plan.",
      "",
      "Prepared from the owner's WoafMeow Health Timeline.",
    );
    return lines.join("\n");
  };

  const loadVetShare = async () => {
    const [records, logs] = await Promise.all([
      getRecords(),
      Promise.resolve(readLogs()),
    ]);
    return {
      records,
      logs,
      title: `${account.petName}'s health timeline`,
      summary: buildVetReadySummary(records, logs),
    };
  };

  const readBlobAsBase64 = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(String(reader.result || "").split(",").pop() || "");
      reader.onerror = () => reject(reader.error || new Error("File could not be read."));
      reader.readAsDataURL(blob);
    });

  const foldBase64 = (value) => String(value || "").match(/.{1,76}/g)?.join("\r\n") || "";
  const safeEmailFileName = (value) =>
    String(value || "health-record")
      .replace(/[\r\n"]/g, "")
      .replace(/[^a-zA-Z0-9._()\- ]/g, "-")
      .slice(0, 120) || "health-record";
  const escapeEmailHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  const emailTimelineRange = (records, logs) => {
    const dates = [...records, ...logs]
      .map((item) => String(item?.date || ""))
      .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
      .sort();
    if (!dates.length)
      return new Intl.DateTimeFormat("en", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(new Date());
    if (dates[0] === dates.at(-1)) return formatDate(dates[0]);
    const start = new Date(`${dates[0]}T12:00:00`);
    const end = new Date(`${dates.at(-1)}T12:00:00`);
    if (
      start.getFullYear() === end.getFullYear() &&
      start.getMonth() === end.getMonth()
    )
      return `${new Intl.DateTimeFormat("en", { month: "short" }).format(start)} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`;
    return `${formatDate(dates[0])}–${formatDate(dates.at(-1))}`;
  };
  const buildVetReadyHtml = (records, logs) => {
    const owner = String(account.ownerName || "Pet owner").trim();
    const vetName = String(vetNameField?.value || "").trim();
    const ownerNote = String(shareNoteField?.value || "").trim();
    const conditions = splitProfileList(account.conditions);
    const medicines = splitProfileList(account.medications);
    const patterns = patternRules
      .filter(([, rule]) => rule.test(combinedText(records, logs)))
      .map(([label]) => label);
    const datedLogs = [...logs].sort((left, right) =>
      String(right.date || "").localeCompare(String(left.date || "")),
    );
    const datedRecords = [...records].sort((left, right) =>
      String(right.date || "").localeCompare(String(left.date || "")),
    );
    const observations = datedLogs.length
      ? datedLogs
          .map((log) => {
            const details = [
              log.weight
                ? `Weight: ${escapeEmailHtml(log.weight)} ${escapeEmailHtml(log.weightUnit || "lb")}`
                : "",
              log.medicineChange
                ? `Related change: ${escapeEmailHtml(log.medicineChange)}`
                : "",
            ].filter(Boolean);
            return `<li style="padding:12px 0;border-bottom:1px solid #eee4dc"><strong style="display:block;margin-bottom:4px">${escapeEmailHtml(formatDate(log.date))} · ${escapeEmailHtml(log.category || "Other")}</strong><span style="display:block;line-height:1.55">${escapeEmailHtml(log.observation || "No observation entered")}</span>${details.length ? `<small style="display:block;margin-top:5px;color:#675b54;line-height:1.45">${details.join(" · ")}</small>` : ""}</li>`;
          })
          .join("")
      : "<li><span>No dated observations saved yet.</span></li>";
    const recordList = datedRecords.length
      ? datedRecords
          .map(
            (record) =>
              `<li style="padding:12px 0;border-bottom:1px solid #eee4dc"><strong style="display:block;margin-bottom:4px">${escapeEmailHtml(formatDate(record.date))} · ${escapeEmailHtml(record.type || "Record")}</strong><span style="display:block;line-height:1.55">${escapeEmailHtml(record.name)}${record.note ? ` — ${escapeEmailHtml(record.note)}` : ""}</span></li>`,
          )
          .join("")
      : "<li><span>No original records were available.</span></li>";
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeEmailHtml(account.petName)} veterinary care summary</title></head><body style="margin:0;background:#f7f1eb;color:#342a25;font-family:Arial,sans-serif"><main style="max-width:760px;margin:0 auto;background:#fff;padding:36px"><header style="border-bottom:4px solid #bd4b2e;padding-bottom:22px"><p style="margin:0 0 8px;color:#bd4b2e;font-size:13px;font-weight:700;letter-spacing:.12em">WOAFMEOW CARE TIMELINE</p><h1 style="margin:0;font:normal 34px/1.08 Georgia,serif">${escapeEmailHtml(account.petName)}’s health timeline and records</h1><p style="margin:12px 0 0;color:#675b54">Timeline: ${escapeEmailHtml(emailTimelineRange(records, logs))}</p></header><section style="padding:24px 0;border-bottom:1px solid #e4d8cf"><p style="font-size:16px;line-height:1.65;margin:0">WoafMeow helps dog families organize changes noticed at home and original health records into a clearer veterinary timeline. ${escapeEmailHtml(owner)} prepared this summary for ${escapeEmailHtml(vetName || "the veterinary team")} and included the source records below.</p></section><section style="padding:24px 0;border-bottom:1px solid #e4d8cf"><h2 style="font:normal 24px Georgia,serif;margin:0 0 14px">Patient at a glance</h2><table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:8px;border:1px solid #e4d8cf"><strong>Dog</strong><br>${escapeEmailHtml(account.petName)}</td><td style="padding:8px;border:1px solid #e4d8cf"><strong>Age</strong><br>${escapeEmailHtml(account.petAge || "Not shared")}</td></tr><tr><td style="padding:8px;border:1px solid #e4d8cf"><strong>Breed or mix</strong><br>${escapeEmailHtml(account.breed || "Not shared")}</td><td style="padding:8px;border:1px solid #e4d8cf"><strong>Weight range</strong><br>${escapeEmailHtml(account.weightRange || "Not shared")}</td></tr></table></section><section style="padding:24px 0;border-bottom:1px solid #e4d8cf"><h2 style="font:normal 24px Georgia,serif;margin:0 0 12px">Reason for sharing</h2><p style="margin:0;line-height:1.6">${escapeEmailHtml(ownerNote || "Please review the timeline and attached records and advise which findings need an appointment, testing or a change in the current care plan.")}</p></section><section style="padding:24px 0;border-bottom:1px solid #e4d8cf"><h2 style="font:normal 24px Georgia,serif;margin:0 0 12px">Known context</h2><p style="margin:6px 0"><strong>Conditions:</strong> ${escapeEmailHtml(conditions.join("; ") || "None shared")}</p><p style="margin:6px 0"><strong>Medicines or recent changes:</strong> ${escapeEmailHtml(medicines.join("; ") || "None shared")}</p><p style="margin:6px 0"><strong>Patterns mentioned:</strong> ${escapeEmailHtml(patterns.join("; ") || "No repeated pattern identified yet")}</p></section><section style="padding:24px 0;border-bottom:1px solid #e4d8cf"><h2 style="font:normal 24px Georgia,serif;margin:0 0 12px">Recent observations</h2><ul style="list-style:none;padding:0;margin:0">${observations}</ul></section><section style="padding:24px 0"><h2 style="font:normal 24px Georgia,serif;margin:0 0 12px">Original records attached</h2><ul style="list-style:none;padding:0;margin:0">${recordList}</ul></section><footer style="margin-top:18px;padding-top:18px;border-top:1px solid #e4d8cf;color:#675b54;font-size:13px;line-height:1.5">Prepared from the owner’s WoafMeow Health Timeline. This email draft was created for the owner to review and send.</footer></main></body></html>`;
  };

  const downloadVetEmail = async () => {
    if (
      vetEmailField &&
      typeof vetEmailField.reportValidity === "function" &&
      !vetEmailField.reportValidity()
    )
      return;
    setShareStatus("Preparing the veterinary email with attached records…");
    try {
      const { summary, records, logs } = await loadVetShare();
      const recipient = String(vetEmailField?.value || "")
        .trim()
        .slice(0, 254);
      const timeline = emailTimelineRange(records, logs);
      const subject = `${account.petName} health timeline & veterinary records — ${timeline}`;
      const htmlSummary = buildVetReadyHtml(records, logs);
      const boundary = `woafmeow_${Date.now().toString(36)}`;
      const alternativeBoundary = `${boundary}_alternative`;
      const lines = [
        "From: WoafMeow Care Timeline <hello@woafmeow.com>",
        `Reply-To: ${String(account.email || "").replace(/[\r\n]/g, "")}`,
        `To: ${recipient}`,
        `Subject: ${subject.replace(/[\r\n]/g, " ")}`,
        `Date: ${new Date().toUTCString()}`,
        "X-Unsent: 1",
        "MIME-Version: 1.0",
        `Content-Type: multipart/mixed; boundary=\"${boundary}\"`,
        "",
        `--${boundary}`,
        `Content-Type: multipart/alternative; boundary=\"${alternativeBoundary}\"`,
        "",
        `--${alternativeBoundary}`,
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: 8bit",
        "",
        "WoafMeow helps dog families organize changes noticed at home and original health records into a clearer veterinary timeline.",
        "",
        summary,
        `--${alternativeBoundary}`,
        "Content-Type: text/html; charset=UTF-8",
        "Content-Transfer-Encoding: 8bit",
        "",
        htmlSummary,
        `--${alternativeBoundary}--`,
      ];
      const attached = records.filter((record) => record?.blob instanceof Blob);
      const summaryFileName = `${safeEmailFileName(account.petName)}-veterinary-care-summary.html`;
      const summaryBase64 = await readBlobAsBase64(
        new Blob([htmlSummary], { type: "text/html;charset=utf-8" }),
      );
      lines.push(
        `--${boundary}`,
        `Content-Type: text/html; charset=UTF-8; name="${summaryFileName}"`,
        `Content-Disposition: attachment; filename="${summaryFileName}"`,
        "Content-Transfer-Encoding: base64",
        "",
        foldBase64(summaryBase64),
      );
      for (const record of attached) {
        const fileName = safeEmailFileName(record.name);
        const mime = record.mime || record.blob.type || "application/octet-stream";
        const base64 = await readBlobAsBase64(record.blob);
        lines.push(
          `--${boundary}`,
          `Content-Type: ${mime}; name=\"${fileName}\"`,
          `Content-Disposition: attachment; filename=\"${fileName}\"`,
          "Content-Transfer-Encoding: base64",
          "",
          foldBase64(base64),
        );
      }
      lines.push(`--${boundary}--`, "");
      const emailFile = new Blob([lines.join("\r\n")], {
        type: "message/rfc822;charset=utf-8",
      });
      const href = URL.createObjectURL(emailFile);
      const link = document.createElement("a");
      link.href = href;
      link.download = `${safeEmailFileName(account.petName)}-veterinary-care-summary.eml`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 2000);
      await notifyWoafMeowOwner("veterinary_email_draft_created", account, {
        attachment_count: attached.length + 1,
        timeline_range: timeline,
      });
      setShareStatus(
        attached.length
          ? `Email draft downloaded with the care summary and ${attached.length} original health record${attached.length === 1 ? "" : "s"} attached. Open it in your email app and send.`
          : "Email draft downloaded with the care summary attached. No original health records were available. Open it in your email app and send.",
      );
    } catch {
      setShareStatus(
        "The veterinary email could not be prepared. Please try again.",
        true,
      );
    }
  };

  const openWebShare = async () => {
    if (typeof navigator.share !== "function") {
      setShareStatus(
        "Sharing is not available in this browser. Use the veterinary email draft instead.",
        true,
      );
      return;
    }
    setShareStatus("Preparing the timeline and saved records…");
    try {
      const { records, title, summary } = await loadVetShare();
      const recordFiles =
        typeof File === "function"
          ? records
              .filter((record) => record.blob && record.name)
              .slice(0, 6)
              .map(
                (record) =>
                  new File([record.blob], record.name, {
                    type:
                      record.mime ||
                      record.blob.type ||
                      "application/octet-stream",
                  }),
              )
          : [];
      const payload = { title, text: summary.slice(0, 7000) };
      if (
        recordFiles.length &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: recordFiles })
      ) {
        payload.files = recordFiles;
      }
      await navigator.share(payload);
      await notifyWoafMeowOwner("health_timeline_shared", account, {
        shared_files: payload.files?.length || 0,
      });
      setShareStatus(
        payload.files
          ? "Timeline and selected records shared."
          : "Timeline summary shared.",
      );
    } catch (error) {
      if (error?.name === "AbortError") {
        setShareStatus("Sharing cancelled.");
        return;
      }
      setShareStatus(
        "The timeline could not be shared. Try the veterinary email draft instead.",
        true,
      );
    }
  };

  const createTimelineItem = (entry) => {
    const article = document.createElement("article");
    article.className = `health-timeline-item is-${entry.kind}`;
    const marker = document.createElement("span");
    marker.className = "health-timeline-marker";
    marker.textContent = entry.kind === "record" ? "R" : "C";
    marker.setAttribute("aria-hidden", "true");
    const content = document.createElement("div");
    const meta = document.createElement("p");
    meta.className = "health-timeline-meta";
    meta.textContent = `${formatDate(entry.date)} · ${entry.kind === "record" ? entry.type : `${entry.category} · ${entry.severity}`}`;
    const title = document.createElement("h3");
    title.textContent =
      entry.kind === "record" ? entry.name : entry.observation;
    const details = document.createElement("p");
    details.textContent =
      entry.kind === "record"
        ? entry.note || "Record saved with no additional note."
        : [
            entry.weight
              ? `Weight: ${entry.weight} ${entry.weightUnit || "lb"}.`
              : "",
            entry.medicineChange
              ? `Related change: ${entry.medicineChange}.`
              : "",
          ]
            .filter(Boolean)
            .join(" ");
    const actions = document.createElement("div");
    actions.className = "health-timeline-actions";
    if (entry.kind === "record" && entry.blob) {
      const download = document.createElement("a");
      const url = URL.createObjectURL(entry.blob);
      download.href = url;
      download.download = entry.name;
      download.textContent = "Open record →";
      download.addEventListener(
        "click",
        () => setTimeout(() => URL.revokeObjectURL(url), 5000),
        { once: true },
      );
      actions.append(download);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      if (!window.confirm("Remove this timeline entry from this browser?"))
        return;
      if (entry.kind === "record")
        await recordTransaction("readwrite", (store) => store.delete(entry.id));
      else writeLogs(readLogs().filter((item) => item.id !== entry.id));
      await notifyWoafMeowOwner("health_timeline_entry_removed", account, {
        entry_kind: entry.kind,
        entry_date: entry.date || "",
      });
      await render();
    });
    actions.append(remove);
    content.append(meta, title);
    if (details.textContent) content.append(details);
    content.append(actions);
    article.append(marker, content);
    return article;
  };

  const render = async () => {
    const [records, logs] = await Promise.all([
      getRecords(),
      Promise.resolve(readLogs()),
    ]);
    const conditions = splitProfileList(account.conditions);
    const medicines = splitProfileList(account.medications);
    root.querySelector("[data-health-condition-count]").textContent = String(
      conditions.length,
    );
    root.querySelector("[data-health-medicine-count]").textContent = String(
      medicines.length,
    );
    root.querySelector("[data-health-change-count]").textContent = String(
      logs.length,
    );

    const text = combinedText(records, logs);
    const foundConditions = conditionRules
      .filter(([, rule]) => rule.test(text))
      .map(([label]) => label);
    const conditionMentions = [...new Set([...conditions, ...foundConditions])];
    mentionSummary.textContent = conditionMentions.length
      ? conditionMentions.join(" · ")
      : "No conditions or condition terms have been added yet.";

    const patterns = patternRules
      .filter(([, rule]) => rule.test(text))
      .map(([label]) => label);
    patternSummary.textContent = patterns.length
      ? `${patterns.slice(0, 5).join(" · ")}. Review the dates below to see what changed together.`
      : "Add a dated observation or text-based record to organize repeated care patterns.";

    const weights = logs
      .filter((log) => Number(log.weight) > 0)
      .sort((left, right) => left.date.localeCompare(right.date));
    if (weights.length >= 2) {
      const first = weights[0];
      const last = weights.at(-1);
      const difference = Number(last.weight) - Number(first.weight);
      const direction =
        Math.abs(difference) < 0.05 ? "steady" : difference > 0 ? "up" : "down";
      weightSummary.textContent = `${first.weight} ${first.weightUnit || "lb"} on ${formatDate(first.date)} → ${last.weight} ${last.weightUnit || "lb"} on ${formatDate(last.date)} (${direction} ${Math.abs(difference).toFixed(1)}).`;
    } else if (weights.length === 1) {
      weightSummary.textContent = `${weights[0].weight} ${weights[0].weightUnit || "lb"} logged on ${formatDate(weights[0].date)}. Add another dated weight to see a direction.`;
    } else {
      weightSummary.textContent = "Add two dated weights to see a direction.";
    }

    const entries = [
      ...records.map((record) => ({ ...record, kind: "record" })),
      ...logs.map((log) => ({ ...log, kind: "log" })),
    ].sort(
      (left, right) =>
        right.date.localeCompare(left.date) ||
        String(right.createdAt).localeCompare(String(left.createdAt)),
    );
    timeline.replaceChildren(...entries.map(createTimelineItem));
    empty.hidden = entries.length !== 0;
  };

  recordForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!recordForm.reportValidity()) return;
    const values = new FormData(recordForm);
    const file = values.get("recordFile");
    if (!(file instanceof File) || !file.name) return;
    if (file.size > MAX_FILE_SIZE) {
      recordNote.textContent = "Choose a file smaller than 15 MB.";
      return;
    }
    if (!supportedExtensions.test(file.name)) {
      recordNote.textContent = "Choose a PDF, TXT, CSV, JPG or PNG file.";
      return;
    }
    recordNote.textContent = "Saving record…";
    try {
      const extractedText =
        TEXT_TYPES.has(file.type) || /\.(txt|csv)$/i.test(file.name)
          ? (await file.text()).slice(0, 50000)
          : "";
      await recordTransaction("readwrite", (store) =>
        store.put({
          id: makeId(),
          petKey,
          date: String(values.get("recordDate") || today),
          type: String(values.get("recordType") || "Other"),
          name: file.name.slice(0, 180),
          mime: file.type || "application/octet-stream",
          size: file.size,
          note: String(values.get("recordNote") || "")
            .trim()
            .slice(0, 700),
          extractedText,
          blob: file,
          createdAt: new Date().toISOString(),
        }),
      );
      await notifyWoafMeowOwner("health_record_saved", account, {
        record_type: String(values.get("recordType") || "Other"),
        record_date: String(values.get("recordDate") || today),
        mime_type: file.type || "application/octet-stream",
        size_bytes: file.size,
      });
      recordForm.reset();
      recordForm.elements.recordDate.value = today;
      recordNote.textContent =
        "Record saved to this browser and added to the timeline.";
      await render();
    } catch {
      recordNote.textContent =
        "This record could not be saved. Check browser storage and try again.";
    }
  });

  logForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!logForm.reportValidity()) return;
    const values = new FormData(logForm);
    const logs = readLogs();
    logs.push({
      id: makeId(),
      petKey,
      date: String(values.get("logDate") || today),
      category: String(values.get("category") || "Other"),
      severity: String(values.get("severity") || "Mild"),
      observation: String(values.get("observation") || "")
        .trim()
        .slice(0, 700),
      weight: String(values.get("weight") || "").trim(),
      weightUnit: String(values.get("weightUnit") || "lb"),
      medicineChange: String(values.get("medicineChange") || "")
        .trim()
        .slice(0, 240),
      createdAt: new Date().toISOString(),
    });
    try {
      writeLogs(logs);
      await notifyWoafMeowOwner("health_timeline_change_saved", account, {
        category: String(values.get("category") || "Other"),
        severity: String(values.get("severity") || "Mild"),
        change_date: String(values.get("logDate") || today),
      });
      logForm.reset();
      logForm.elements.logDate.value = today;
      logNote.textContent = "Change added to the timeline.";
      await render();
    } catch {
      logNote.textContent =
        "This browser could not save the change. Check browser storage and try again.";
    }
  });

  root
    .querySelector("[data-health-print]")
    ?.addEventListener("click", () => window.print());
  shareForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!shareForm.reportValidity()) return;
    downloadVetEmail();
  });
  emailVetButton?.addEventListener("click", (event) => {
    if (
      shareForm &&
      emailVetButton.form === shareForm &&
      emailVetButton.type === "submit"
    )
      return;
    event.preventDefault();
    downloadVetEmail();
  });
  webShareButton?.addEventListener("click", (event) => {
    event.preventDefault();
    openWebShare();
  });
  render().catch(() => {
    if (recordNote)
      recordNote.textContent =
        "Health Timeline storage is unavailable in this browser.";
  });
})();

(() => {
  const directory = document.querySelector("[data-directory-controls]");
  if (!directory) return;

  const search = directory.querySelector("[data-directory-search]");
  const category = directory.querySelector("[data-directory-category]");
  const region = directory.querySelector("[data-directory-region]");
  const filterButtons = [
    ...document.querySelectorAll("[data-directory-filter]"),
  ];
  const items = [...document.querySelectorAll("[data-directory-item]")];
  const totalCount = document.querySelector("[data-directory-results-count]");
  const profileCount = document.querySelector("[data-directory-profile-count]");
  const resourceCount = document.querySelector(
    "[data-directory-resource-count]",
  );
  const profileEmpty = document.querySelector("[data-directory-profile-empty]");
  const resourceEmpty = document.querySelector(
    "[data-directory-resource-empty]",
  );
  const loadMore = document.querySelector("[data-directory-load-more]");
  const applyButton = directory.querySelector("[data-directory-apply]");
  const resultsSection = document.querySelector("[data-directory-results]");
  let profileLimit = 9;
  let resourceLimit = 3;

  const requestedCare = new URLSearchParams(window.location.search).get("care");
  if (
    requestedCare &&
    category &&
    [...category.options].some((option) => option.value === requestedCare)
  ) {
    category.value = requestedCare;
  }

  const itemMatches = (item, query, selectedCategory, selectedRegion) => {
    const searchable = (item.dataset.search || "").toLocaleLowerCase();
    const categories = (item.dataset.categories || "")
      .split("|")
      .filter(Boolean);
    const itemRegion = item.dataset.region || "all";
    return (
      (!query || searchable.includes(query)) &&
      (selectedCategory === "all" || categories.includes(selectedCategory)) &&
      (selectedRegion === "all" ||
        itemRegion === "all" ||
        itemRegion === selectedRegion)
    );
  };

  const resultLabel = (count, singular, plural) =>
    `${count} ${count === 1 ? singular : plural}`;

  const updateDirectory = () => {
    const query = (search?.value || "").trim().toLocaleLowerCase();
    const selectedCategory = category?.value || "all";
    const selectedRegion = region?.value || "all";
    const matchingProfileItems = [];
    const matchingResourceItems = [];
    items.forEach((item) => {
      const matches = itemMatches(
        item,
        query,
        selectedCategory,
        selectedRegion,
      );
      item.hidden = true;
      if (!matches) return;
      if (item.hasAttribute("data-directory-profile"))
        matchingProfileItems.push(item);
      else if (item.hasAttribute("data-directory-resource"))
        matchingResourceItems.push(item);
    });

    const matchingProfiles = matchingProfileItems.length;
    const matchingResources = matchingResourceItems.length;
    const perOrganizationLimit = Math.max(3, Math.ceil(profileLimit / 3));
    const organizationCounts = new Map();
    let visibleProfiles = 0;
    matchingProfileItems.forEach((item) => {
      if (visibleProfiles >= profileLimit) return;
      const organization = (item.dataset.organization || "Other")
        .trim()
        .toLocaleLowerCase();
      const organizationCount = organizationCounts.get(organization) || 0;
      if (organizationCount >= perOrganizationLimit) return;
      organizationCounts.set(organization, organizationCount + 1);
      visibleProfiles += 1;
      item.hidden = false;
    });
    const visibleResources = Math.min(resourceLimit, matchingResources);
    matchingResourceItems
      .slice(0, visibleResources)
      .forEach((item) => (item.hidden = false));

    if (profileCount)
      profileCount.textContent = resultLabel(
        matchingProfiles,
        "profile",
        "profiles",
      );
    if (resourceCount)
      resourceCount.textContent = resultLabel(
        matchingResources,
        "resource",
        "resources",
      );
    if (totalCount)
      totalCount.textContent = resultLabel(
        matchingProfiles + matchingResources,
        "result",
        "results",
      );
    if (profileEmpty) profileEmpty.hidden = matchingProfiles !== 0;
    if (resourceEmpty) resourceEmpty.hidden = matchingResources !== 0;
    if (loadMore) {
      const remaining =
        Math.max(0, matchingProfiles - visibleProfiles) +
        Math.max(0, matchingResources - visibleResources);
      loadMore.hidden = remaining === 0;
      loadMore.textContent = "Show more providers →";
    }

    filterButtons.forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.directoryFilter === selectedCategory),
      );
    });
  };

  const showResults = () => {
    updateDirectory();
    resultsSection?.scrollIntoView({ behavior: "auto", block: "start" });
  };

  search?.addEventListener("input", updateDirectory);
  category?.addEventListener("change", () => {
    profileLimit = 9;
    resourceLimit = 3;
    updateDirectory();
  });
  region?.addEventListener("change", () => {
    profileLimit = 9;
    resourceLimit = 3;
    updateDirectory();
  });
  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextCategory = button.dataset.directoryFilter || "all";
      if (
        category &&
        [...category.options].some((option) => option.value === nextCategory)
      ) {
        category.value = nextCategory;
      }
      profileLimit = 9;
      resourceLimit = 3;
      showResults();
    });
  });
  applyButton?.addEventListener("click", showResults);
  loadMore?.addEventListener("click", () => {
    profileLimit += 9;
    resourceLimit += 3;
    updateDirectory();
  });

  updateDirectory();
})();
