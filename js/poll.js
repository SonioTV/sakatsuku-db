(() => {
  "use strict";

  const SUPABASE_URL = "https://atmbnnlaamlucyqyouro.supabase.co";

  // Supabase Dashboard:
  // Settings → API Keys → Publishable key
  // 下の文字列だけを実際のPublishable keyへ置き換えてください。
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_uyGHXw_kIDqcwhIIPOc7uA_N-XgBYAY";

  const POLL_SELECTOR = ".site-poll";
  const STORAGE_PREFIX = "sakatsuku_poll_v1:";
  const REQUEST_TIMEOUT_MS = 12000;

  const TEXT = {
    loading: "アンケートを読み込んでいます…",
    vote: "投票する",
    voting: "投票中…",
    resultTitle: "みんなの投票結果",
    totalVotes: "合計",
    votesUnit: "票",
    alreadyVoted: "投票ありがとうございました",
    selectRequired: "選択肢を1つ選んでください。",
    loadError: "アンケートを読み込めませんでした。",
    voteError: "投票を送信できませんでした。",
    retry: "再読み込み",
    notFound: "アンケートが見つからないか、受付を終了しています。",
    configError: "アンケート設定が完了していません。"
  };

  const hasValidConfig =
    SUPABASE_URL.startsWith("https://") &&
    SUPABASE_URL.includes(".supabase.co") &&
    SUPABASE_PUBLISHABLE_KEY &&
    !SUPABASE_PUBLISHABLE_KEY.includes("ここに");

  const supabaseFactory = window.supabase?.createClient;
  const client =
    hasValidConfig && typeof supabaseFactory === "function"
      ? supabaseFactory(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
          }
        })
      : null;

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function storageKey(pollKey) {
    return `${STORAGE_PREFIX}${pollKey}`;
  }

  function getStoredVote(pollKey) {
    try {
      return JSON.parse(localStorage.getItem(storageKey(pollKey)) || "null");
    } catch {
      return null;
    }
  }

  function saveStoredVote(pollKey, optionId) {
    try {
      localStorage.setItem(
        storageKey(pollKey),
        JSON.stringify({
          optionId,
          votedAt: new Date().toISOString()
        })
      );
    } catch {
      // localStorageが使えない環境でも投票処理自体は続行する
    }
  }

  function setStatus(container, message, type = "loading", withRetry = false) {
    container.innerHTML = `
      <section class="poll-card poll-card--status" aria-live="polite">
        <p class="poll-status poll-status--${escapeHtml(type)}">${escapeHtml(message)}</p>
        ${
          withRetry
            ? `<button type="button" class="poll-retry-button">${escapeHtml(TEXT.retry)}</button>`
            : ""
        }
      </section>
    `;
  }

  function normalizePollRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return null;
    }

    return {
      pollId: rows[0].poll_id,
      pollKey: rows[0].poll_key,
      question: rows[0].question,
      options: rows.map((row) => ({
        id: row.option_id,
        label: row.option_label,
        sortOrder: Number(row.sort_order || 0)
      }))
    };
  }

  function renderVoteForm(container, poll) {
    const groupName = `poll-${poll.pollId}`;

    container.innerHTML = `
      <section class="poll-card" aria-labelledby="${escapeHtml(groupName)}-question">
        <div class="poll-topline">
          <div class="poll-heading">
            <span class="poll-heading-icon" aria-hidden="true">Q</span>
            <span>読者アンケート</span>
          </div>
          <span class="poll-private-note">1ブラウザ1票</span>
        </div>

        <div class="poll-question" id="${escapeHtml(groupName)}-question">
          ${escapeHtml(poll.question)}
        </div>

        <form class="poll-form" novalidate>
          <fieldset class="poll-options">
            <legend class="sr-only">${escapeHtml(poll.question)}</legend>

            ${poll.options
              .map(
                (option) => `
                  <label class="poll-option">
                    <input
                      type="radio"
                      name="${escapeHtml(groupName)}"
                      value="${escapeHtml(option.id)}"
                    >
                    <span class="poll-option-control" aria-hidden="true"></span>
                    <span class="poll-option-label">${escapeHtml(option.label)}</span>
                  </label>
                `
              )
              .join("")}
          </fieldset>

          <p class="poll-form-message" aria-live="polite"></p>

          <button type="submit" class="poll-submit-button">
            <span>${escapeHtml(TEXT.vote)}</span>
            <span class="poll-submit-arrow" aria-hidden="true">→</span>
          </button>

          <p class="poll-before-note">投票すると、みんなの結果が表示されます。</p>
        </form>
      </section>
    `;

    const form = container.querySelector(".poll-form");
    const button = container.querySelector(".poll-submit-button");
    const message = container.querySelector(".poll-form-message");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      const checked = form.querySelector('input[type="radio"]:checked');
      if (!checked) {
        message.textContent = TEXT.selectRequired;
        message.className = "poll-form-message poll-form-message--error";
        return;
      }

      message.textContent = "";
      message.className = "poll-form-message";
      button.disabled = true;
      button.textContent = TEXT.voting;
      form
        .querySelectorAll('input[type="radio"]')
        .forEach((input) => (input.disabled = true));

      try {
        const resultRows = await rpcWithTimeout("vote_poll", {
          target_poll_key: poll.pollKey,
          target_option_id: checked.value
        });

        saveStoredVote(poll.pollKey, checked.value);
        renderResults(container, poll.question, resultRows, checked.value);
      } catch (error) {
        console.error("[poll] vote failed:", error);
        message.textContent = TEXT.voteError;
        message.className = "poll-form-message poll-form-message--error";
        button.disabled = false;
        button.textContent = TEXT.vote;
        form
          .querySelectorAll('input[type="radio"]')
          .forEach((input) => (input.disabled = false));
      }
    });
  }

  function renderResults(container, question, rows, selectedOptionId = null) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const totalVotes = safeRows.length
      ? Number(safeRows[0].total_votes || 0)
      : 0;

    container.innerHTML = `
      <section class="poll-card poll-card--results">
        <div class="poll-topline poll-topline--results">
          <div class="poll-heading">
            <span class="poll-heading-icon" aria-hidden="true">✓</span>
            <span>${escapeHtml(TEXT.resultTitle)}</span>
          </div>
          <div class="poll-total-chip">
            <span>合計</span>
            <strong>${totalVotes.toLocaleString("ja-JP")}</strong>
            <span>票</span>
          </div>
        </div>

        <div class="poll-question">${escapeHtml(question)}</div>

        <div class="poll-results-list">
          ${safeRows
            .map((row) => {
              const percentage = Number(row.percentage || 0);
              const isSelected =
                selectedOptionId && String(row.option_id) === String(selectedOptionId);

              return `
                <div class="poll-result${isSelected ? " poll-result--selected" : ""}">
                  <div class="poll-result-header">
                    <span class="poll-result-label">
                      ${escapeHtml(row.option_label)}
                      ${isSelected ? '<span class="poll-selected-badge">あなたの投票</span>' : ""}
                    </span>
                    <span class="poll-result-value">
                      ${percentage.toFixed(1)}%
                    </span>
                  </div>

                  <div
                    class="poll-result-bar"
                    role="progressbar"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    aria-valuenow="${percentage}"
                    aria-label="${escapeHtml(row.option_label)} ${percentage.toFixed(1)}%"
                  >
                    <span
                      class="poll-result-bar-fill"
                      style="width: ${Math.min(100, Math.max(0, percentage))}%"
                    ></span>
                  </div>

                  <div class="poll-result-votes">
                    ${Number(row.vote_count || 0).toLocaleString("ja-JP")} ${escapeHtml(TEXT.votesUnit)}
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>

        <p class="poll-voted-note">${escapeHtml(TEXT.alreadyVoted)}</p>
      </section>
    `;
  }

  async function rpcWithTimeout(functionName, params) {
    if (!client) {
      throw new Error("Supabase client is not configured.");
    }

    const request = client.rpc(functionName, params);
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Request timed out.")), REQUEST_TIMEOUT_MS);
    });

    const response = await Promise.race([request, timeout]);

    if (response.error) {
      throw response.error;
    }

    return response.data;
  }

  async function loadPoll(container) {
    const pollKey = container.dataset.pollKey?.trim();

    if (!pollKey) {
      setStatus(container, "data-poll-keyが設定されていません。", "error");
      return;
    }

    if (!hasValidConfig || !client) {
      setStatus(container, TEXT.configError, "error");
      return;
    }

    setStatus(container, TEXT.loading, "loading");

    try {
      const pollRows = await rpcWithTimeout("get_poll", {
        target_poll_key: pollKey
      });

      const poll = normalizePollRows(pollRows);
      if (!poll) {
        setStatus(container, TEXT.notFound, "error");
        return;
      }

      const storedVote = getStoredVote(pollKey);

      if (storedVote?.optionId) {
        const resultRows = await rpcWithTimeout("get_poll_results", {
          target_poll_key: pollKey
        });
        renderResults(container, poll.question, resultRows, storedVote.optionId);
        return;
      }

      renderVoteForm(container, poll);
    } catch (error) {
      console.error("[poll] load failed:", error);
      setStatus(container, TEXT.loadError, "error", true);

      const retryButton = container.querySelector(".poll-retry-button");
      retryButton?.addEventListener("click", () => loadPoll(container), {
        once: true
      });
    }
  }

  function initPolls() {
    document.querySelectorAll(POLL_SELECTOR).forEach((container) => {
      if (container.dataset.pollInitialized === "true") {
        return;
      }

      container.dataset.pollInitialized = "true";
      loadPoll(container);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPolls, { once: true });
  } else {
    initPolls();
  }
})();
