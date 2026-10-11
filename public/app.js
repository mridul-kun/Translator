"use strict";
(() => {
    "use strict";
    const LANGS = {
        en: { name: "English", speech: "en-US" },
        ja: { name: "Japanese", speech: "ja-JP" },
    };
    const BANK_KEY = "kotoba-ja-bank";
    const HISTORY_KEY = "kotoba-ja-history";
    const missingIds = [];
    function $(id) {
        const node = document.getElementById(id);
        if (!node) {
            missingIds.push(id);
            return document.createElement("div"); // keeps the rest of the app working
        }
        return node;
    }
    const el = {
        input: $("input"),
        output: $("output"),
        status: $("status"),
        count: $("count"),
        fromLabel: $("fromLabel"),
        toLabel: $("toLabel"),
        swap: $("swap"),
        clear: $("clear"),
        speakFrom: $("speakFrom"),
        speakTo: $("speakTo"),
        copy: $("copy"),
        save: $("save"),
        historyBtn: $("historyBtn"),
        savedBtn: $("savedBtn"),
        drawer: $("drawer"),
        drawerTitle: $("drawerTitle"),
        drawerList: $("drawerList"),
        drawerClear: $("drawerClear"),
        uploadPanel: $("uploadPanel"),
        drop: $("drop"),
        dropTitle: $("dropTitle"),
        dropHint: $("dropHint"),
        fileInput: $("fileInput"),
        preview: $("preview"),
        modelBtn: $("modelBtn"),
        modelLabel: $("modelLabel"),
        modelMenu: $("modelMenu"),
        advDesc: $("advDesc"),
        kbBtn: $("kbBtn"),
        osk: $("osk"),
        oskTitle: $("oskTitle"),
        oskKeys: $("oskKeys"),
        oskKana: $("oskKana"),
        oskClose: $("oskClose"),
        roman: $("roman"),
        gloss: $("gloss"),
        glossPos: $("glossPos"),
        glossChips: $("glossChips"),
        glossLink: $("glossLink"),
        more: $("more"),
        moreList: $("moreList"),
        expandAll: $("expandAll"),
        translator: $("translator"),
        imgView: $("imgView"),
        imgCols: $("imgCols"),
        origCol: $("origCol"),
        origImg: $("origImg"),
        outCanvas: $("outCanvas"),
        showOriginal: $("showOriginal"),
        imgCopy: $("imgCopy"),
        imgDownload: $("imgDownload"),
        imgClose: $("imgClose"),
        docView: $("docView"),
        docName: $("docName"),
        docNote: $("docNote"),
        docDownload: $("docDownload"),
        docOpen: $("docOpen"),
        docAlt: $("docAlt"),
        docSize: $("docSize"),
        kanaLine: $("kanaLine"),
        themeToggle: $("themeToggle"),
        docClose: $("docClose"),
    };
    const state = { from: "en", to: "ja", lastSource: "", lastResult: "" };
    let model = "classic";
    let seq = 0; // numbers each translation so an older, slower reply never overwrites a newer one
    let timer;
    let imageRun = 0; // numbers each image job so an older one never overwrites a newer one
    let currentImage = null;
    let imageText = "";
    const IMAGE_HINT = "Supported file types: .png, .jpg, .webp, .bmp. Text in the picture is read and translated.";
    const DOC_HINT = "Supported file types: .docx, .pdf, .pptx, .xlsx, .txt";
    const DOC_ACCEPT = ".docx,.pdf,.pptx,.xlsx,.txt";
    let docRun = 0; // numbers each document job so an older one never overwrites a newer one
    let currentDocFile = null;
    let docResult = null;
    let docUrl = "";
    let docAlt = null;
    /* ---------- storage ---------- */
    function loadList(key) {
        try {
            const parsed = JSON.parse(localStorage.getItem(key) ?? "[]");
            return Array.isArray(parsed) ? parsed : [];
        }
        catch {
            return [];
        }
    }
    function saveList(key, list) {
        try {
            localStorage.setItem(key, JSON.stringify(list));
        }
        catch {
            setStatus("Could not save on this device.");
        }
    }
    const loadBank = () => loadList(BANK_KEY);
    const saveBank = (list) => saveList(BANK_KEY, list);
    /* ---------- UI helpers ---------- */
    function setStatus(msg = "") {
        el.status.textContent = msg;
    }
    function showOutput(text, placeholder) {
        el.output.textContent = text;
        el.output.classList.toggle("placeholder", placeholder);
        el.output.classList.toggle("ja", state.to === "ja");
        el.output.lang = state.to;
    }
    function applyDirection() {
        el.fromLabel.textContent = LANGS[state.from].name;
        el.toLabel.textContent = LANGS[state.to].name;
        el.input.lang = state.from;
        el.input.classList.toggle("ja", state.from === "ja");
        el.input.placeholder = state.from === "ja" ? "日本語を入力" : "Type or paste English here";
        if (!el.osk.hidden)
            renderKeyboard();
        renderKanaLine();
    }
    function updateCount() {
        el.count.textContent = `${el.input.value.length} / ${el.input.maxLength}`;
    }
    /* ---------- translation (calls our own backend) ---------- */
    async function requestChunk(text) {
        const res = await fetch("/api/translate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, from: state.from, to: state.to, mode: model }),
        });
        const data = (await res.json());
        if (!res.ok || !data.translation) {
            throw new Error(data.error ?? `Request failed (${res.status})`);
        }
        return data.translation;
    }
    // The server accepts 500 characters per request, so longer text is sent in sentence-based parts.
    function splitChunks(text, max = 450) {
        const sentences = text.match(/[^.!?。！？\n]*[.!?。！？]+|[^.!?。！？\n]+/g) ?? [text];
        const chunks = [];
        let cur = "";
        for (const part of sentences) {
            for (let rest = part; rest.length > 0; rest = rest.slice(max)) {
                const piece = rest.slice(0, max);
                if (cur && (cur + piece).length > max) {
                    chunks.push(cur);
                    cur = "";
                }
                cur += piece;
            }
        }
        if (cur.trim())
            chunks.push(cur);
        return chunks;
    }
    async function translate() {
        window.clearTimeout(timer);
        const typed = el.input.value.trim();
        renderKanaLine();
        const text = state.from === "ja" ? prepareJapanese(typed).send.trim() : typed;
        if (!text) {
            seq++;
            clearOutput();
            return;
        }
        const mine = ++seq;
        setStatus("Translating…");
        try {
            const chunks = splitChunks(text);
            const parts = [];
            for (const [i, chunk] of chunks.entries()) {
                if (chunks.length > 1)
                    setStatus(`Translating part ${i + 1} of ${chunks.length}…`);
                parts.push(await requestChunk(chunk.trim()));
                if (mine !== seq)
                    return; // newer input arrived; drop this result
            }
            const translation = parts.join(chunks.length > 1 ? "\n" : "");
            state.lastSource = text;
            state.lastResult = translation;
            showOutput(translation, false);
            addHistory(text, translation);
            setStatus("");
            if (!wantListening) {
                void lookup(text, mine); // extra dictionary data waits until Speak is off
                void showPronunciation(translation, mine);
            }
        }
        catch (err) {
            if (mine !== seq)
                return;
            showOutput("Translation failed. Check your connection and try again.", true);
            hideLookup();
            setStatus(err instanceof Error ? err.message : "Unknown error");
        }
    }
    function swap() {
        if (wantListening)
            stopListening(false);
        window.clearTimeout(timer);
        seq++;
        hideLookup();
        const prevInput = el.input.value;
        const prevResult = state.lastResult;
        [state.from, state.to] = [state.to, state.from];
        applyDirection();
        if (prevResult) {
            el.input.value = prevResult;
            state.lastSource = prevResult;
            state.lastResult = prevInput;
            showOutput(prevInput, false);
        }
        else {
            showOutput("Your translation appears here.", true);
        }
        updateCount();
        renderKanaLine();
        el.swap.classList.toggle("spin");
        if (mode === "image" && currentImage)
            void processImage(currentImage); // read and translate again for the new direction
        if (mode === "document" && currentDocFile)
            void processDocument(currentDocFile);
    }
    /* ---------- speech, copy, save ---------- */
    function speak(text, lang) {
        if (!text)
            return;
        if (!("speechSynthesis" in window)) {
            setStatus("Speech is not supported in this browser.");
            return;
        }
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = LANGS[lang].speech;
        u.rate = 0.85; // slower, easier for learners
        const voice = window.speechSynthesis.getVoices().find((v) => v.lang === u.lang);
        if (voice)
            u.voice = voice;
        else if (lang === "ja")
            setStatus("No Japanese voice found; install one in your system settings.");
        window.speechSynthesis.speak(u);
    }
    async function copyResult() {
        if (!state.lastResult)
            return;
        try {
            await navigator.clipboard.writeText(state.lastResult);
            setStatus("Copied.");
        }
        catch {
            setStatus("Copy blocked by the browser.");
        }
    }
    function saveCurrent() {
        if (!state.lastResult) {
            setStatus("Translate something first.");
            return;
        }
        const entry = state.from === "ja"
            ? { ja: state.lastSource, en: state.lastResult }
            : { ja: state.lastResult, en: state.lastSource };
        const rom = el.roman.hidden ? "" : (el.roman.textContent ?? "").trim();
        if (rom && state.to === "ja")
            entry.rom = rom;
        const list = loadBank();
        const exists = list.some((p) => p.ja === entry.ja && p.en === entry.en);
        if (!exists) {
            saveBank([entry, ...list].slice(0, 100));
            renderDrawer();
        }
        setStatus(exists ? "Already in your word bank." : "Saved.");
    }
    /* ---------- lists ---------- */
    function useEntry(entry) {
        state.from = "ja";
        state.to = "en";
        applyDirection();
        el.input.value = entry.ja;
        updateCount();
        void translate();
        window.scrollTo({ top: 0, behavior: "smooth" });
    }
    function makeButton(label, aria, onClick) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "icon";
        b.textContent = label;
        b.setAttribute("aria-label", aria);
        b.addEventListener("click", onClick);
        return b;
    }
    function makeItem(entry, onRemove) {
        const li = document.createElement("li");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "item";
        const ja = document.createElement("span");
        ja.className = "ja-line";
        ja.lang = "ja";
        ja.textContent = entry.ja;
        const sub = document.createElement("span");
        sub.className = "sub";
        sub.textContent = (entry.rom ? `${entry.rom} — ` : "") + entry.en;
        btn.append(ja, sub);
        btn.addEventListener("click", () => useEntry(entry));
        li.appendChild(btn);
        li.appendChild(makeButton("🔊", "Listen in Japanese", () => speak(entry.ja, "ja")));
        if (onRemove)
            li.appendChild(makeButton("✕", "Remove from word bank", onRemove));
        return li;
    }
    /* ---------- History and Saved drawer ---------- */
    let openPanel = null;
    function addHistory(source, result) {
        const entry = state.from === "ja" ? { ja: source, en: result } : { ja: result, en: source };
        const list = loadList(HISTORY_KEY);
        // Live typing makes a translation at every pause. If the new text only extends or shortens
        // the last entry, replace that entry so History keeps one line per phrase.
        const last = list[0];
        const lastSource = last ? (state.from === "ja" ? last.ja : last.en) : "";
        const sameSession = lastSource !== "" && (source.startsWith(lastSource) || lastSource.startsWith(source));
        const rest = (sameSession ? list.slice(1) : list).filter((p) => !(p.ja === entry.ja && p.en === entry.en));
        saveList(HISTORY_KEY, [entry, ...rest].slice(0, 50));
        if (openPanel === "history")
            renderDrawer();
    }
    function renderDrawer() {
        el.historyBtn.classList.toggle("on", openPanel === "history");
        el.savedBtn.classList.toggle("on", openPanel === "saved");
        el.historyBtn.setAttribute("aria-expanded", String(openPanel === "history"));
        el.savedBtn.setAttribute("aria-expanded", String(openPanel === "saved"));
        el.drawer.hidden = openPanel === null;
        if (!openPanel)
            return;
        const isHistory = openPanel === "history";
        const key = isHistory ? HISTORY_KEY : BANK_KEY;
        const list = loadList(key);
        el.drawerTitle.textContent = isHistory ? "History" : "Saved";
        el.drawerClear.hidden = !isHistory || list.length === 0;
        if (!list.length) {
            const li = document.createElement("li");
            li.className = "empty";
            li.textContent = isHistory
                ? "Your translations will appear here."
                : "Nothing saved yet. Tap the star under a translation to save it.";
            el.drawerList.replaceChildren(li);
            return;
        }
        el.drawerList.replaceChildren(...list.map((entry, i) => makeItem(entry, () => {
            const cur = loadList(key);
            cur.splice(i, 1);
            saveList(key, cur);
            renderDrawer();
        })));
    }
    function togglePanel(panel) {
        openPanel = openPanel === panel ? null : panel;
        renderDrawer();
    }
    const speakPill = $("speakPill");
    if (/KotobaDesktop/.test(navigator.userAgent))
        speakPill.hidden = true; // the desktop app has no speech service
    const speechApi = window;
    const SpeechRec = speechApi.SpeechRecognition ?? speechApi.webkitSpeechRecognition;
    const SPEECH_INTERVAL = 1200; // while you speak, the translation refreshes at most this often (ms)
    let wantListening = false; // true from pressing Speak until Speak is turned off
    let recognition = null;
    let baseText = ""; // what was already in the box when this stretch of listening began
    let finalText = ""; // words the recognizer has finished with in this stretch
    let speechTimer;
    let speechBusy = false;
    let speechDirty = false;
    // Joins two pieces of speech, adding a space for English and none for Japanese.
    function glue(a, b) {
        if (!b)
            return a;
        if (!a)
            return b.trimStart();
        if (state.from === "ja" || /\s$/.test(a) || /^\s/.test(b))
            return a + b;
        return `${a} ${b}`;
    }
    function setListening(on) {
        speakPill.classList.toggle("listening", on);
        speakPill.setAttribute("aria-pressed", String(on));
    }
    // Translates while you speak, one request at a time, so slow replies are never thrown away.
    async function speechTranslate() {
        if (speechBusy) {
            speechDirty = true;
            return;
        }
        speechBusy = true;
        try {
            do {
                speechDirty = false;
                if (el.input.value.trim())
                    await translate();
            } while (speechDirty && wantListening);
        }
        finally {
            speechBusy = false;
        }
    }
    function scheduleSpeechTranslate() {
        if (speechTimer !== undefined)
            return;
        speechTimer = window.setTimeout(() => {
            speechTimer = undefined;
            void speechTranslate();
        }, SPEECH_INTERVAL);
    }
    // Types the words into the box as they are heard, including the ones still being recognized.
    function showSpeech(interim) {
        el.input.value = glue(baseText, glue(finalText, interim)).slice(0, el.input.maxLength);
        el.input.scrollTop = el.input.scrollHeight;
        updateCount();
        scheduleSpeechTranslate();
    }
    function speechErrorMessage(code) {
        if (code === "not-allowed" || code === "service-not-allowed") {
            return "Microphone blocked. Allow it from the address bar and try again.";
        }
        if (code === "audio-capture")
            return "No microphone was found.";
        if (code === "network") {
            return /Electron|Code\//.test(navigator.userAgent)
                ? "Voice input does not work inside VS Code's built-in browser. Open http://localhost:3000 in Chrome or Edge."
                : "The browser could not reach its speech service. Check your internet connection, turn off any VPN or proxy, or try Microsoft Edge. Brave does not support voice input.";
        }
        return `Voice input error: ${code}`;
    }
    function startSession() {
        if (!SpeechRec || !wantListening)
            return;
        const rec = new SpeechRec();
        rec.lang = LANGS[state.from].speech; // listens in the language shown on the left
        rec.continuous = true; // keep listening across pauses
        rec.interimResults = true; // report words while they are still being spoken
        rec.maxAlternatives = 1;
        baseText = el.input.value;
        finalText = "";
        rec.onresult = (e) => {
            if (!wantListening)
                return; // Speak was turned off: ignore anything still arriving
            let interim = "";
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const result = e.results[i];
                const piece = result[0]?.transcript ?? "";
                if (result.isFinal)
                    finalText = glue(finalText, piece);
                else
                    interim = glue(interim, piece);
            }
            showSpeech(interim);
        };
        rec.onerror = (e) => {
            if (e.error === "no-speech" || e.error === "aborted")
                return; // normal; onend restarts if still wanted
            stopListening(false);
            setStatus(speechErrorMessage(e.error));
        };
        rec.onend = () => {
            recognition = null;
            if (wantListening) {
                // Browsers end a session after a while or after silence. Carry on until Speak is turned off.
                window.setTimeout(() => {
                    if (wantListening)
                        startSession();
                }, 250);
            }
            else {
                setListening(false);
            }
        };
        recognition = rec;
        try {
            rec.start();
        }
        catch {
            /* already started */
        }
    }
    function startListening() {
        if (!SpeechRec) {
            setStatus("Voice input is not supported in this browser. Try Chrome or Edge.");
            return;
        }
        wantListening = true;
        setListening(true);
        hideLookup();
        setStatus(`Listening in ${LANGS[state.from].name}… speak now`);
        startSession();
    }
    function stopListening(translateAfter = true) {
        wantListening = false;
        window.clearTimeout(speechTimer);
        speechTimer = undefined;
        speechDirty = false;
        setListening(false);
        recognition?.abort(); // drops anything still being processed, so nothing more gets typed
        recognition = null;
        if (translateAfter && el.input.value.trim())
            void translate(); // one last pass so the result matches the box
    }
    speakPill.addEventListener("click", () => (wantListening ? stopListening() : startListening()));
    const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
    const JSZIP_URL = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
    const PDFJS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";
    const PDFJS_WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
    const TEXT_MAX = 500;
    const libs = window;
    const modeButtons = document.querySelectorAll(".pill[data-mode]");
    let mode = "text";
    let previewUrl = "";
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const tag = document.createElement("script");
            tag.src = src;
            tag.onload = () => resolve();
            tag.onerror = () => reject(new Error("Could not load a required library. Check your internet connection."));
            document.head.appendChild(tag);
        });
    }
    function setMode(next) {
        if ((next === "image" || next === "document") && mode === next)
            return;
        mode = next;
        el.translator.classList.toggle("image-mode", next === "image");
        el.translator.classList.toggle("doc-mode", next === "document");
        if (next !== "image") {
            imageRun++; // stop any image job still running
            currentImage = null;
            el.imgView.hidden = true;
        }
        if (next !== "document") {
            docRun++; // stop any document job still running
            currentDocFile = null;
            el.docView.hidden = true;
        }
        modeButtons.forEach((b) => {
            const on = b.dataset.mode === next;
            b.classList.toggle("active", on);
            b.setAttribute("aria-pressed", String(on));
        });
        el.uploadPanel.hidden = next === "text";
        el.input.maxLength = TEXT_MAX;
        el.preview.hidden = true;
        if (next === "image") {
            el.fileInput.accept = "image/png,image/jpeg,image/webp,image/bmp";
            el.dropHint.textContent = IMAGE_HINT;
        }
        else if (next === "document") {
            el.fileInput.accept = DOC_ACCEPT;
            el.dropHint.textContent = DOC_HINT;
        }
        updateCount();
    }
    async function handleFile(file) {
        if (mode === "image")
            await processImage(file);
        else
            await processDocument(file);
    }
    modeButtons.forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
    el.fileInput.addEventListener("change", () => {
        const file = el.fileInput.files?.[0];
        if (file)
            void handleFile(file);
        el.fileInput.value = "";
    });
    el.drop.addEventListener("dragover", (e) => {
        e.preventDefault();
        el.drop.classList.add("over");
    });
    el.drop.addEventListener("dragleave", () => el.drop.classList.remove("over"));
    el.drop.addEventListener("drop", (e) => {
        e.preventDefault();
        el.drop.classList.remove("over");
        const file = e.dataTransfer?.files[0];
        if (file)
            void handleFile(file);
    });
    setMode("text");
    /* ---------- Live translation, model menu and on-screen keyboard ---------- */
    const MODEL_KEY = "kotoba-model";
    let advancedAvailable = false;
    function clearOutput() {
        hideLookup();
        state.lastSource = "";
        state.lastResult = "";
        showOutput("Your translation appears here.", true);
        setStatus();
    }
    function scheduleTranslate() {
        window.clearTimeout(timer);
        const text = el.input.value.trim();
        if (!text) {
            seq++;
            clearOutput();
            return;
        }
        if (text.length > TEXT_MAX) {
            setStatus("Long text: press Ctrl + Enter to translate.");
            return;
        }
        timer = window.setTimeout(() => void translate(), 500);
    }
    function renderModel() {
        el.modelLabel.textContent = model === "advanced" ? "Advanced" : "Normal";
        el.modelMenu.querySelectorAll(".menu-item").forEach((item) => {
            const on = item.dataset.model === model;
            item.classList.toggle("on", on);
            item.setAttribute("aria-checked", String(on));
            if (item.dataset.model === "advanced")
                item.disabled = !advancedAvailable;
        });
        el.advDesc.textContent = advancedAvailable
            ? "Improved accuracy, built with Claude"
            : "Not set up. Add ANTHROPIC_API_KEY to your .env file.";
    }
    function openMenu(open) {
        el.modelMenu.hidden = !open;
        el.modelBtn.setAttribute("aria-expanded", String(open));
    }
    function setModel(next) {
        if (next === "advanced" && !advancedAvailable)
            return;
        model = next;
        try {
            localStorage.setItem(MODEL_KEY, next);
        }
        catch {
            /* storage unavailable; the choice just will not be remembered */
        }
        renderModel();
        openMenu(false);
        const len = el.input.value.trim().length;
        if (len > 0 && len <= TEXT_MAX)
            void translate(); // redo the current text with the new model
    }
    async function loadConfig() {
        try {
            const res = await fetch("/api/config");
            const cfg = (await res.json());
            advancedAvailable = Boolean(cfg.advanced);
        }
        catch {
            advancedAvailable = false;
        }
        let saved = null;
        try {
            saved = localStorage.getItem(MODEL_KEY);
        }
        catch {
            /* ignore */
        }
        model = saved === "advanced" && advancedAvailable ? "advanced" : "classic";
        renderModel();
    }
    const EN_ROW1 = "`1234567890-=";
    const EN_ROW2 = "qwertyuiop[]";
    const EN_ROW3 = "asdfghjkl;'";
    const EN_ROW4 = "zxcvbnm,./";
    const SHIFT_SYMBOLS = {
        "`": "~", "1": "!", "2": "@", "3": "#", "4": "$", "5": "%", "6": "^", "7": "&", "8": "*", "9": "(", "0": ")",
        "-": "_", "=": "+", "[": "{", "]": "}", "\\": "|", ";": ":", "'": '"', ",": "<", ".": ">", "/": "?",
    };
    // The "Ctrl + Alt" keys switch on a layer of accented letters and symbols.
    const ALT_KEYS = {
        a: "á", e: "é", i: "í", o: "ó", u: "ú", n: "ñ", c: "ç", s: "ß", y: "ý", "1": "¡", "2": "²", "3": "£", "4": "€", "/": "¿", "-": "–",
    };
    const ALT_UPPER = { a: "Á", e: "É", i: "Í", o: "Ó", u: "Ú", n: "Ñ", c: "Ç", y: "Ý" };
    const JA_ROWS = [
        "あいうえおかきくけこ", "さしすせそたちつてと", "なにぬねのはひふへほ", "まみむめもやゆよらり", "るれろわをんー、。？",
        "がぎぐげござじずぜぞ", "だぢづでどばびぶべぼ", "ぱぴぷぺぽゃゅょっ！", "ぁぃぅぇぉ",
    ];
    let shift = false;
    let caps = false;
    let alt = false;
    let katakana = false;
    function toKatakana(ch) {
        const c = ch.charCodeAt(0);
        return c >= 0x3041 && c <= 0x3096 ? String.fromCharCode(c + 0x60) : ch;
    }
    function fireInput() {
        el.input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    function insertText(text) {
        const start = el.input.selectionStart;
        const end = el.input.selectionEnd;
        if (el.input.value.length - (end - start) + text.length > el.input.maxLength) {
            setStatus("Character limit reached.");
            return;
        }
        el.input.setRangeText(text, start, end, "end");
        el.input.focus();
        fireInput();
    }
    function backspace() {
        let start = el.input.selectionStart;
        const end = el.input.selectionEnd;
        if (start === end && start > 0)
            start -= 1;
        if (start === end)
            return;
        el.input.setRangeText("", start, end, "end");
        el.input.focus();
        fireInput();
    }
    // The character a key produces right now, given Shift, Caps Lock and the Ctrl + Alt layer.
    function charFor(base) {
        const upper = shift !== caps; // Shift flips Caps Lock, like a real keyboard
        if (alt) {
            const mapped = (upper && ALT_UPPER[base]) || ALT_KEYS[base];
            if (mapped)
                return mapped;
        }
        if (/[a-z]/.test(base))
            return upper ? base.toUpperCase() : base;
        return shift ? (SHIFT_SYMBOLS[base] ?? base) : base;
    }
    function pressChar(base) {
        insertText(charFor(base));
        if (shift) {
            shift = false; // Shift applies to one key only
            renderKeyboard();
        }
    }
    function makeKey(label, grow, onPress, extra = "", aria = "") {
        const b = document.createElement("button");
        b.type = "button";
        b.className = extra ? `key ${extra}` : "key";
        b.textContent = label;
        b.style.flexGrow = String(grow);
        if (aria)
            b.setAttribute("aria-label", aria);
        b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the cursor in the text box
        b.addEventListener("click", onPress);
        return b;
    }
    function makeGap(grow) {
        const gap = document.createElement("span");
        gap.className = "key-gap";
        gap.style.flexGrow = String(grow);
        return gap;
    }
    function makeKeyRow(...items) {
        const row = document.createElement("div");
        row.className = "osk-row";
        row.append(...items);
        return row;
    }
    function englishRows() {
        const chars = (set) => Array.from(set).map((c) => makeKey(charFor(c), 1, () => pressChar(c)));
        const toggleShift = () => {
            shift = !shift;
            renderKeyboard();
        };
        const toggleAlt = () => {
            alt = !alt;
            renderKeyboard();
        };
        const fn = (on) => (on ? "fn on" : "fn");
        return [
            makeKeyRow(...chars(EN_ROW1), makeKey("⌫", 2, backspace, "fn", "Backspace")),
            makeKeyRow(makeGap(1.5), ...chars(EN_ROW2), makeKey(charFor("\\"), 1.5, () => pressChar("\\"))),
            makeKeyRow(makeKey("⇪", 1.8, () => { caps = !caps; renderKeyboard(); }, fn(caps), "Caps Lock"), ...chars(EN_ROW3), makeGap(2.2)),
            makeKeyRow(makeKey("⇧", 2.3, toggleShift, fn(shift), "Shift"), ...chars(EN_ROW4), makeKey("⇧", 2.7, toggleShift, fn(shift), "Shift")),
            makeKeyRow(makeKey("Ctrl + Alt", 2.6, toggleAlt, fn(alt)), makeKey("", 9.8, () => insertText(" "), "space", "Space"), makeKey("Ctrl + Alt", 2.6, toggleAlt, fn(alt))),
        ];
    }
    function kanaRows() {
        const rows = JA_ROWS.map((row) => makeKeyRow(...Array.from(row).map((ch) => {
            const value = katakana ? toKatakana(ch) : ch;
            return makeKey(value, 0, () => insertText(value), "kana");
        })));
        rows.push(makeKeyRow(makeKey("", 0, () => insertText(" "), "space kana-space", "Space"), makeKey("⌫", 0, backspace, "fn kana", "Backspace")));
        return rows;
    }
    function renderKeyboard() {
        const ja = state.from === "ja";
        el.oskTitle.textContent = ja ? "Japanese" : "English";
        el.oskKana.hidden = !ja;
        el.oskKana.textContent = katakana ? "ひらがな" : "カタカナ";
        el.osk.classList.toggle("kana-layout", ja);
        el.oskKeys.replaceChildren(...(ja ? kanaRows() : englishRows()));
    }
    function toggleKeyboard() {
        const open = el.osk.hidden;
        el.osk.hidden = !open;
        el.kbBtn.setAttribute("aria-pressed", String(open));
        if (open) {
            renderKeyboard();
            el.input.focus();
        }
    }
    el.modelBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openMenu(Boolean(el.modelMenu.hidden));
    });
    el.modelMenu.querySelectorAll(".menu-item").forEach((item) => item.addEventListener("click", () => setModel(item.dataset.model)));
    document.addEventListener("click", (e) => {
        if (!el.modelMenu.hidden && !el.modelMenu.contains(e.target))
            openMenu(false);
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape")
            openMenu(false);
    });
    el.kbBtn.addEventListener("click", toggleKeyboard);
    el.oskClose.addEventListener("click", toggleKeyboard);
    el.oskKana.addEventListener("click", () => {
        katakana = !katakana;
        renderKeyboard();
    });
    renderModel();
    void loadConfig();
    const LOOKUP_MAX = 120; // only short words and phrases get a dictionary lookup
    const ICON_PATHS = {
        speak: "M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z",
        copy: "M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z",
        star: "M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z",
    };
    const romajiCache = new Map();
    const loaders = new WeakMap();
    let romajiChain = Promise.resolve();
    let allOpen = false;
    const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
    const trimEnd = (s) => s.trim().replace(/[。．.!?！？\s]+$/u, "");
    const dictionaryUrl = (word) => `https://jisho.org/search/${encodeURIComponent(word)}`;
    // Pronunciation in Latin letters. One request at a time, so expanding many rows
    // does not flood the free service.
    function fetchRomaji(text) {
        const cached = romajiCache.get(text);
        if (cached !== undefined)
            return Promise.resolve(cached);
        const job = romajiChain
            .then(async () => {
            const res = await fetch(`/api/romaji?text=${encodeURIComponent(text)}`);
            if (!res.ok)
                throw new Error(`Pronunciation failed (${res.status})`);
            const data = (await res.json());
            const romaji = (data.romaji ?? "").trim();
            if (romaji)
                romajiCache.set(text, romaji);
            return romaji;
        })
            .catch(() => "");
        romajiChain = job;
        return job;
    }
    async function showPronunciation(text, mine) {
        if (state.to !== "ja" || text.length > 200) {
            el.roman.hidden = true;
            return;
        }
        const romaji = await fetchRomaji(text);
        if (mine !== seq)
            return;
        el.roman.textContent = romaji;
        el.roman.hidden = romaji === "";
    }
    function hideLookup() {
        el.roman.hidden = true;
        el.roman.textContent = "";
        el.gloss.hidden = true;
        el.more.hidden = true;
        el.moreList.replaceChildren();
        allOpen = false;
        el.expandAll.textContent = "Expand all";
    }
    function iconButton(path, label, onClick) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "icon";
        b.title = label;
        b.setAttribute("aria-label", label);
        const ns = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("aria-hidden", "true");
        const shape = document.createElementNS(ns, "path");
        shape.setAttribute("d", path);
        svg.appendChild(shape);
        b.appendChild(svg);
        b.addEventListener("click", onClick);
        return b;
    }
    function makeChip(text, lang) {
        const chip = document.createElement("span");
        chip.className = lang === "ja" ? "chip ja" : "chip";
        chip.lang = lang;
        chip.textContent = text;
        return chip;
    }
    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            setStatus("Copied.");
        }
        catch {
            setStatus("Copy blocked by the browser.");
        }
    }
    function saveToBank(entry) {
        const list = loadBank();
        const exists = list.some((p) => p.ja === entry.ja && p.en === entry.en);
        if (!exists) {
            saveBank([entry, ...list].slice(0, 100));
            if (openPanel === "saved")
                renderDrawer();
        }
        setStatus(exists ? "Already in Saved." : "Saved.");
    }
    function openRow(row, open) {
        row.classList.toggle("open", open);
        row.querySelector(".toggle")?.setAttribute("aria-expanded", String(open));
        const load = loaders.get(row);
        if (open && load) {
            loaders.delete(row); // pronunciation is fetched the first time a row is opened
            load();
        }
    }
    function makeRow(entry, source) {
        const target = state.to;
        const li = document.createElement("li");
        li.className = "more-row";
        const word = document.createElement("span");
        word.className = target === "ja" ? "more-word ja" : "more-word";
        word.lang = target;
        word.textContent = entry.word;
        const pos = document.createElement("span");
        pos.className = "more-pos";
        pos.textContent = cap(entry.pos);
        const chips = document.createElement("span");
        chips.className = "more-chips";
        chips.append(...entry.meanings.map((m) => makeChip(m, state.from)));
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "icon toggle";
        toggle.textContent = "▾";
        toggle.setAttribute("aria-label", "Show details");
        toggle.setAttribute("aria-expanded", "false");
        toggle.addEventListener("click", () => openRow(li, !li.classList.contains("open")));
        const detail = document.createElement("div");
        detail.className = "more-detail";
        const romaji = document.createElement("p");
        romaji.className = "more-romaji";
        const link = document.createElement("a");
        link.textContent = "See dictionary";
        link.href = dictionaryUrl(target === "ja" ? entry.word : trimEnd(source));
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        const bar = document.createElement("div");
        bar.className = "more-bar";
        bar.append(iconButton(ICON_PATHS.speak, "Listen", () => speak(entry.word, target)), iconButton(ICON_PATHS.copy, "Copy", () => void copyText(entry.word)), iconButton(ICON_PATHS.star, "Save translation", () => saveToBank(target === "ja"
            ? { ja: entry.word, en: source, rom: romaji.textContent || undefined }
            : { ja: source, en: entry.word })), link);
        detail.append(romaji, bar);
        loaders.set(li, () => {
            if (target === "ja")
                void fetchRomaji(entry.word).then((r) => { romaji.textContent = r; });
        });
        li.append(word, pos, chips, toggle, detail);
        return li;
    }
    function showLookup(data) {
        const main = trimEnd(state.lastResult);
        const source = state.lastSource;
        const entries = (data.entries ?? []).filter((e) => e.meanings.length > 0);
        const matched = entries.find((e) => e.word.toLowerCase() === main.toLowerCase());
        const rest = entries.filter((e) => e !== matched);
        // Summary under the translated word: part of speech, meanings and a dictionary link.
        el.glossPos.textContent = cap(matched?.pos ?? "");
        el.glossChips.replaceChildren(...(matched?.meanings ?? []).slice(0, 5).map((m) => makeChip(m, state.from)));
        el.glossLink.href = dictionaryUrl(state.to === "ja" ? main : trimEnd(source));
        el.gloss.hidden = false;
        allOpen = false;
        el.expandAll.textContent = "Expand all";
        el.moreList.replaceChildren(...rest.map((e) => makeRow(e, source)));
        el.more.hidden = rest.length === 0;
    }
    async function lookup(text, mine) {
        if (text.length > LOOKUP_MAX || text.includes("\n")) {
            el.gloss.hidden = true;
            el.more.hidden = true;
            return;
        }
        try {
            const query = new URLSearchParams({ text, from: state.from, to: state.to });
            const res = await fetch(`/api/lookup?${query.toString()}`);
            if (!res.ok)
                throw new Error(`Lookup failed (${res.status})`);
            const data = (await res.json());
            if (mine === seq)
                showLookup(data);
        }
        catch {
            if (mine === seq) {
                el.gloss.hidden = true;
                el.more.hidden = true; // the extra data is optional, so fail quietly
            }
        }
    }
    el.expandAll.addEventListener("click", () => {
        allOpen = !allOpen;
        el.moreList.querySelectorAll(".more-row").forEach((row) => openRow(row, allOpen));
        el.expandAll.textContent = allOpen ? "Collapse all" : "Expand all";
    });
    const MAX_REGIONS = 60;
    const imgNote = (msg) => {
        el.dropHint.textContent = msg;
    };
    function tidyOcr(text, lang) {
        const flat = text.replace(/\s+/g, " ").trim();
        return lang === "ja" ? flat.replace(/([\u3000-\u9fff\uff00-\uffef])\s+(?=[\u3000-\u9fff\uff00-\uffef])/g, "$1") : flat;
    }
    function collectLines(data) {
        if (data.lines && data.lines.length > 0)
            return data.lines;
        return (data.blocks ?? []).flatMap((b) => (b.paragraphs ?? []).flatMap((p) => p.lines ?? []));
    }
    // A line is cut where two words are far apart, so "Indent" and "Spacing" become two labels.
    function linePieces(line, lang, scale) {
        const words = (line.words ?? []).filter((w) => (w.text ?? "").trim() !== "");
        const lineH = Math.max(1, line.bbox.y1 - line.bbox.y0);
        const groups = [];
        for (const w of words) {
            const cur = groups[groups.length - 1];
            const prev = cur?.[cur.length - 1];
            if (cur && prev && w.bbox.x0 - prev.bbox.x1 <= 1.6 * lineH)
                cur.push(w);
            else
                groups.push([w]);
        }
        const sources = groups.length === 0
            ? [{ text: line.text ?? "", box: line.bbox, conf: line.confidence }]
            : groups.map((g) => {
                const confs = g.map((w) => w.confidence).filter((c) => c !== undefined);
                return {
                    text: g.map((w) => w.text ?? "").join(lang === "ja" ? "" : " "),
                    box: {
                        x0: Math.min(...g.map((w) => w.bbox.x0)),
                        y0: Math.min(...g.map((w) => w.bbox.y0)),
                        x1: Math.max(...g.map((w) => w.bbox.x1)),
                        y1: Math.max(...g.map((w) => w.bbox.y1)),
                    },
                    conf: confs.length > 0 ? confs.reduce((a, b) => a + b, 0) / confs.length : undefined,
                };
            });
        const pieces = [];
        for (const src of sources) {
            const text = tidyOcr(src.text, lang);
            if (!/[\p{L}\p{N}]/u.test(text) || (src.conf !== undefined && src.conf < 25))
                continue;
            pieces.push({ text, x0: src.box.x0 / scale, y0: src.box.y0 / scale, x1: src.box.x1 / scale, y1: src.box.y1 / scale });
        }
        return pieces;
    }
    // Lines that sit close together and line up are joined into one paragraph so a sentence
    // is translated as a whole. Labels, and anything ending in a colon, stay on their own.
    function groupPieces(pieces, lang, gapFactor = 0.6) {
        const sorted = [...pieces].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
        const groups = [];
        for (const p of sorted) {
            const target = groups.find((grp) => {
                const last = grp[grp.length - 1];
                const hl = last.y1 - last.y0;
                const hp = p.y1 - p.y0;
                const h = Math.max(hl, hp);
                const gap = p.y0 - last.y1;
                const aligned = Math.abs(p.x0 - last.x0) < 1.5 * h || Math.abs((p.x0 + p.x1) / 2 - (last.x0 + last.x1) / 2) < 1.5 * h;
                return Math.min(hl, hp) / h > 0.6 && gap > -0.3 * h && gap < gapFactor * h && aligned && !/[:：]$/.test(last.text);
            });
            if (target)
                target.push(p);
            else
                groups.push([p]);
        }
        return groups.map((g) => ({
            text: g.map((p) => p.text).join(lang === "ja" ? "" : " "),
            x0: Math.min(...g.map((p) => p.x0)),
            y0: Math.min(...g.map((p) => p.y0)),
            x1: Math.max(...g.map((p) => p.x1)),
            y1: Math.max(...g.map((p) => p.y1)),
            lines: g.length,
        }));
    }
    function ocrRegions(data, lang, scale) {
        return groupPieces(collectLines(data).flatMap((line) => linePieces(line, lang, scale)), lang);
    }
    // Small text is read far more reliably when the picture is enlarged first.
    async function prepareForOcr(src) {
        const img = await loadImage(src);
        const scale = Math.min(3, Math.max(1, 1800 / img.naturalWidth));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx)
            throw new Error("This browser cannot prepare the picture.");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return { canvas, scale };
    }
    async function readRegions() {
        imgNote("Loading the text reader. The first time can take a minute…");
        if (!libs.Tesseract)
            await loadScript(TESSERACT_URL);
        const reader = libs.Tesseract;
        if (!reader)
            throw new Error("The text reader failed to load.");
        const lang = state.from;
        const { canvas, scale } = await prepareForOcr(previewUrl);
        const worker = await reader.createWorker(lang === "ja" ? "jpn" : "eng", 1, {
            logger: (m) => {
                if (m.status === "recognizing text")
                    imgNote(`Reading the image… ${Math.round(m.progress * 100)}%`);
            },
        });
        try {
            await worker.setParameters({ tessedit_pageseg_mode: "11" }); // "sparse text": finds scattered labels
            const { data } = await worker.recognize(canvas);
            return ocrRegions(data, lang, scale);
        }
        finally {
            await worker.terminate();
        }
    }
    async function translatePiece(text) {
        const parts = [];
        for (const chunk of splitChunks(text))
            parts.push(await requestChunk(chunk.trim()));
        return parts.join(state.to === "ja" ? "" : " ");
    }
    const normText = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    // Web addresses, brand names and bare numbers are left exactly as they are.
    const leaveAlone = (t) => !/\p{L}/u.test(t) || /^(https?:\/\/|www\.)\S+$/i.test(t) || /^\S+\.(com|org|net|io|co|edu|gov)(\/\S*)?$/i.test(t);
    // Translates up to three regions at a time. A region that fails is left unchanged in the picture.
    async function translateRegions(regions, run) {
        const out = regions.map(() => "");
        const todo = regions.filter((r) => !leaveAlone(r.text)).length;
        let next = 0;
        let done = 0;
        let failed = 0;
        const worker = async () => {
            while (next < regions.length && run === imageRun) {
                const i = next++;
                if (leaveAlone(regions[i].text))
                    continue;
                try {
                    const translated = await translatePiece(regions[i].text);
                    out[i] = normText(translated) === normText(regions[i].text) ? "" : translated; // nothing to change
                }
                catch {
                    failed++;
                }
                done++;
                if (run === imageRun)
                    imgNote(`Translating… ${done} of ${todo}`);
            }
        };
        await Promise.all([worker(), worker(), worker()]);
        if (todo > 0 && failed === todo)
            throw new Error("Translation failed. Check your connection and try again.");
        return out;
    }
    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error("Could not open that image."));
            img.src = src;
        });
    }
    // Average colour of a thin ring just outside the text box, used to blank out the old text.
    function sampleBackground(ctx, cw, ch, b) {
        const strips = [
            [b.x0, b.y0 - 3, b.x1 - b.x0, 2],
            [b.x0, b.y1 + 1, b.x1 - b.x0, 2],
            [b.x0 - 3, b.y0, 2, b.y1 - b.y0],
            [b.x1 + 1, b.y0, 2, b.y1 - b.y0],
        ];
        let r = 0;
        let g = 0;
        let bl = 0;
        let n = 0;
        for (const [sx, sy, sw, sh] of strips) {
            const x = Math.max(0, Math.floor(sx));
            const y = Math.max(0, Math.floor(sy));
            const w = Math.min(cw, Math.ceil(sx + sw)) - x;
            const h = Math.min(ch, Math.ceil(sy + sh)) - y;
            if (w <= 0 || h <= 0)
                continue;
            const d = ctx.getImageData(x, y, w, h).data;
            for (let i = 0; i + 3 < d.length; i += 4) {
                r += d[i];
                g += d[i + 1];
                bl += d[i + 2];
                n++;
            }
        }
        return n > 0 ? [Math.round(r / n), Math.round(g / n), Math.round(bl / n)] : [255, 255, 255];
    }
    function wrapText(ctx, text, maxWidth, byChar) {
        const tokens = byChar ? Array.from(text) : text.split(/\s+/).filter(Boolean);
        const sep = byChar ? "" : " ";
        const lines = [];
        let cur = "";
        for (const token of tokens) {
            const test = cur ? cur + sep + token : token;
            if (cur && ctx.measureText(test).width > maxWidth) {
                lines.push(cur);
                cur = token;
            }
            else {
                cur = test;
            }
        }
        if (cur)
            lines.push(cur);
        return lines;
    }
    async function paintTranslation(src, regions, texts) {
        const img = await loadImage(src);
        const canvas = el.outCanvas;
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx)
            throw new Error("This browser cannot draw the translated picture.");
        ctx.drawImage(img, 0, 0);
        const byChar = state.to === "ja";
        const family = byChar ? '"Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif' : '"Roboto", "Segoe UI", sans-serif';
        try {
            await document.fonts.load(`16px ${family.split(",")[0]}`, texts.join(""));
        }
        catch {
            /* the system font is used instead */
        }
        // Measure every background before painting, so one painted box never changes another's colour.
        const pad = 2;
        const boxes = regions.map((r) => ({
            x0: Math.max(0, r.x0 - pad),
            y0: Math.max(0, r.y0 - pad),
            x1: Math.min(canvas.width, r.x1 + pad),
            y1: Math.min(canvas.height, r.y1 + pad),
        }));
        const backgrounds = boxes.map((b) => sampleBackground(ctx, canvas.width, canvas.height, b));
        boxes.forEach((b, i) => {
            const text = texts[i];
            const w = b.x1 - b.x0;
            const h = b.y1 - b.y0;
            if (!text || w < 6 || h < 6)
                return;
            const [r, g, bl] = backgrounds[i];
            ctx.fillStyle = `rgb(${r},${g},${bl})`;
            ctx.fillRect(b.x0, b.y0, w, h);
            ctx.fillStyle = 0.299 * r + 0.587 * g + 0.114 * bl > 140 ? "#111111" : "#f5f5f5";
            ctx.textBaseline = "top";
            let size = Math.max(10, Math.min(64, Math.floor((h / Math.max(1, regions[i].lines)) * 0.9)));
            let lines = [];
            for (; size >= 8; size--) {
                ctx.font = `${size}px ${family}`;
                lines = wrapText(ctx, text, w - 4, byChar);
                if (lines.length * size * 1.25 <= h)
                    break; // the largest size that fits the box
            }
            const lineHeight = size * 1.25;
            const startY = b.y0 + Math.max(0, (h - lines.length * lineHeight) / 2);
            lines.forEach((line, k) => {
                if (startY + k * lineHeight < b.y1)
                    ctx.fillText(line, b.x0 + 2, startY + k * lineHeight);
            });
        });
    }
    async function processImage(file) {
        if (!file.type.startsWith("image/")) {
            imgNote("Please choose an image file (PNG, JPG or WebP).");
            return;
        }
        currentImage = file;
        const run = ++imageRun;
        el.imgView.hidden = true;
        el.uploadPanel.hidden = false;
        if (previewUrl)
            URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(file);
        el.preview.src = previewUrl;
        el.preview.hidden = false;
        try {
            const found = await readRegions();
            if (run !== imageRun)
                return;
            if (found.length === 0) {
                imgNote("No text was found in that image. Try a clearer or larger picture.");
                return;
            }
            const regions = found.slice(0, MAX_REGIONS);
            const texts = await translateRegions(regions, run);
            if (run !== imageRun)
                return;
            if (texts.every((t) => !t)) {
                imgNote("Nothing in that image needed translating.");
                return;
            }
            await paintTranslation(previewUrl, regions, texts);
            if (run !== imageRun)
                return;
            imageText = texts.filter(Boolean).join("\n\n");
            el.origImg.src = previewUrl;
            el.showOriginal.checked = true;
            applyOriginalToggle();
            el.imgView.hidden = false;
            el.uploadPanel.hidden = true;
            el.preview.hidden = true;
            imgNote(IMAGE_HINT);
        }
        catch (err) {
            if (run === imageRun)
                imgNote(err instanceof Error ? err.message : "Could not translate that image.");
        }
    }
    function applyOriginalToggle() {
        el.origCol.hidden = !el.showOriginal.checked;
        el.imgCols.classList.toggle("single", !el.showOriginal.checked);
    }
    function closeImage() {
        imageRun++;
        currentImage = null;
        imageText = "";
        el.imgView.hidden = true;
        el.preview.hidden = true;
        el.uploadPanel.hidden = false;
        imgNote(IMAGE_HINT);
    }
    function flashLabel(button, message) {
        const label = button.querySelector("span");
        if (!label)
            return;
        const original = label.textContent;
        label.textContent = message;
        window.setTimeout(() => {
            label.textContent = original;
        }, 1500);
    }
    el.showOriginal.addEventListener("change", applyOriginalToggle);
    el.imgClose.addEventListener("click", closeImage);
    el.imgCopy.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(imageText);
            flashLabel(el.imgCopy, "Copied");
        }
        catch {
            flashLabel(el.imgCopy, "Copy blocked");
        }
    });
    el.imgDownload.addEventListener("click", () => {
        el.outCanvas.toBlob((blob) => {
            if (!blob)
                return;
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = "translation.png";
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }, "image/png");
    });
    const MAX_DOC_UNITS = 400;
    const MAX_DOC_BYTES = 25 * 1024 * 1024;
    const DOC_CONCURRENCY = 4;
    const PDFLIB_URL = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";
    const FONTKIT_URL = "https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js";
    const PDF_FONT_URL = "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/mplus1p/MPLUS1p-Regular.ttf"; // Japanese and Latin letters
    const OOXML_MIME = {
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
    const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
    const S_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    const XML_NS = "http://www.w3.org/XML/1998/namespace";
    const docStatus = (msg) => {
        el.dropHint.textContent = msg;
    };
    const formatSize = (bytes) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
    function docKind(name) {
        const ext = name.toLowerCase().split(".").pop() ?? "";
        if (ext === "docx" || ext === "pptx" || ext === "xlsx" || ext === "pdf" || ext === "txt")
            return ext;
        if (ext === "doc" || ext === "ppt" || ext === "xls") {
            throw new Error(`Old .${ext} files are not supported. Save it as .${ext}x in Office and try again.`);
        }
        throw new Error("Unsupported file type. Use .docx, .pdf, .pptx, .xlsx or .txt.");
    }
    function translatedName(name, ext) {
        return `${name.replace(/\.[^.]+$/, "")}.translated.${ext}`;
    }
    /* ----- writing PDFs ----- */
    let fontPromise = null;
    async function newPdfWriter(existing) {
        if (!libs.PDFLib)
            await loadScript(PDFLIB_URL);
        if (!libs.fontkit)
            await loadScript(FONTKIT_URL);
        const lib = libs.PDFLib;
        if (!lib || !libs.fontkit)
            throw new Error("The PDF writer failed to load.");
        docStatus("Preparing the PDF. The first time it downloads a font, which can take a moment…");
        fontPromise ?? (fontPromise = fetch(PDF_FONT_URL)
            .then((res) => {
            if (!res.ok)
                throw new Error(`The PDF font could not be downloaded (${res.status}).`);
            return res.arrayBuffer();
        })
            .catch((err) => {
            fontPromise = null;
            throw err;
        }));
        const fontBytes = await fontPromise;
        let doc;
        try {
            doc = existing ? await lib.PDFDocument.load(existing, { ignoreEncryption: true }) : await lib.PDFDocument.create();
        }
        catch {
            throw new Error("This PDF is protected or damaged, so it cannot be translated.");
        }
        doc.registerFontkit(libs.fontkit);
        return { doc, font: await doc.embedFont(fontBytes, { subset: false }), lib };
    }
    const cleanForPdf = (t) => t.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/ {2,}/g, " ").trim();
    function wrapPdfText(font, text, size, maxWidth, byChar) {
        const tokens = byChar ? (text.match(/[\x21-\x7e]+|\s+|[^\x00-\x7f]/g) ?? []) : text.split(/(\s+)/).filter((t) => t !== "");
        const lines = [];
        let cur = "";
        for (const tok of tokens) {
            const space = /^\s+$/.test(tok);
            if (space && !cur)
                continue;
            if (cur && font.widthOfTextAtSize((cur + tok).trimEnd(), size) > maxWidth) {
                lines.push(cur.trimEnd());
                cur = space ? "" : tok;
            }
            else {
                cur += tok;
            }
        }
        if (cur.trim())
            lines.push(cur.trimEnd());
        return lines;
    }
    // A clean, readable PDF built from the translated text. Used for Word, PowerPoint, Excel and text files.
    async function renderFlowPdf(blocks, byChar) {
        const { doc, font } = await newPdfWriter();
        const W = 595;
        const H = 842;
        const M = 56;
        const sizes = { title: 20, heading: 15, body: 11, row: 10 };
        let page = doc.addPage([W, H]);
        let y = H - M;
        for (const block of blocks) {
            if (block.kind === "break") {
                page = doc.addPage([W, H]);
                y = H - M;
                continue;
            }
            const text = cleanForPdf(block.text);
            if (!text)
                continue;
            const size = sizes[block.kind];
            const lineHeight = size * 1.5;
            if (block.kind === "title" || block.kind === "heading")
                y -= size * 0.5;
            for (const line of wrapPdfText(font, text, size, W - 2 * M, byChar)) {
                if (y - lineHeight < M) {
                    page = doc.addPage([W, H]);
                    y = H - M;
                }
                y -= lineHeight;
                page.drawText(line, { x: M, y: y + lineHeight * 0.28, size, font });
            }
            y -= size * 0.6;
        }
        return doc.save();
    }
    // The original PDF is kept (pictures, lines, layout). Each block of text is covered and the translation is written over it.
    async function overlayPdf(original, regions, tops, translated) {
        const { doc, font, lib } = await newPdfWriter(original);
        const pages = doc.getPages();
        const byChar = state.to === "ja";
        const white = lib.rgb(1, 1, 1);
        const black = lib.rgb(0, 0, 0);
        const perPage = new Map();
        regions.forEach((r, i) => {
            if (translated[i])
                perPage.set(r.page, [...(perPage.get(r.page) ?? []), i]);
        });
        for (const [pageIndex, indexes] of perPage) {
            const page = pages[pageIndex];
            if (!page)
                continue;
            const placed = indexes.map((i) => {
                const r = regions[i];
                return { r, text: cleanForPdf(translated[i]), x: r.x0, w: r.x1 - r.x0, h: r.y1 - r.y0, bottom: tops[pageIndex] - r.y1 };
            });
            for (const p of placed)
                page.drawRectangle({ x: p.x - 2, y: p.bottom - 1.5, width: p.w + 6, height: p.h + 3, color: white });
            for (const p of placed) {
                let size = Math.max(6, Math.min(26, p.h / p.r.lines / 1.25));
                let lines = [];
                for (; size >= 5; size -= 0.5) {
                    lines = wrapPdfText(font, p.text, size, p.w, byChar);
                    if (lines.length * size * 1.2 <= p.h + size * 0.4)
                        break; // the largest size that fits
                }
                lines.forEach((line, k) => page.drawText(line, { x: p.x, y: p.bottom + p.h - size * 0.95 - k * size * 1.2, size, font, color: black }));
            }
        }
        return doc.save();
    }
    /* ----- Word, PowerPoint, Excel ----- */
    function nearestParagraph(node, ns) {
        for (let n = node.parentElement; n; n = n.parentElement) {
            if (n.localName === "p" && n.namespaceURI === ns)
                return n;
        }
        return null;
    }
    // The first text run gets the whole translation and the others are emptied, so the paragraph keeps its style.
    function writeRuns(runs, value) {
        runs.forEach((t, i) => {
            t.textContent = i === 0 ? value : "";
        });
        runs[0].setAttributeNS(XML_NS, "xml:space", "preserve");
    }
    function paragraphSlots(xml, ns, part) {
        const slots = [];
        for (const p of Array.from(xml.getElementsByTagNameNS(ns, "p"))) {
            const runs = Array.from(p.getElementsByTagNameNS(ns, "t")).filter((t) => nearestParagraph(t, ns) === p);
            const text = runs.map((t) => t.textContent ?? "").join("");
            if (text.trim() === "")
                continue;
            const style = p.getElementsByTagNameNS(ns, "pStyle")[0]?.getAttributeNS(ns, "val") ?? "";
            const kind = /^title$/i.test(style) ? "title" : /^(heading|subtitle)/i.test(style) ? "heading" : "body";
            slots.push({ text, kind, part, set: (value) => writeRuns(runs, value) });
        }
        return slots;
    }
    function sharedStringTexts(xml) {
        const all = [];
        const slots = [];
        Array.from(xml.getElementsByTagNameNS(S_NS, "si")).forEach((si, ref) => {
            const runs = Array.from(si.getElementsByTagNameNS(S_NS, "t")).filter((t) => t.parentElement?.localName !== "rPh");
            const text = runs.map((t) => t.textContent ?? "").join("");
            all.push(text);
            if (text.trim() !== "")
                slots.push({ text, ref, set: (value) => writeRuns(runs, value) });
        });
        return { all, slots };
    }
    function cellText(c, shared) {
        const type = c.getAttribute("t");
        const v = c.getElementsByTagNameNS(S_NS, "v")[0]?.textContent ?? "";
        if (type === "s")
            return shared[Number(v)] ?? "";
        if (type === "inlineStr")
            return Array.from(c.getElementsByTagNameNS(S_NS, "t")).map((x) => x.textContent ?? "").join("");
        if (type === "b")
            return v === "1" ? "TRUE" : "FALSE";
        return type === "e" ? "" : v;
    }
    // Each sheet becomes a heading followed by its rows, with cells separated by " | ".
    async function xlsxBlocks(zip, shared) {
        const parse = async (name) => {
            const entry = zip.files[name];
            return entry ? new DOMParser().parseFromString(await entry.async("string"), "application/xml") : null;
        };
        const workbook = await parse("xl/workbook.xml");
        const names = workbook ? Array.from(workbook.getElementsByTagNameNS(S_NS, "sheet")).map((s) => s.getAttribute("name") ?? "") : [];
        const sheetFiles = Object.keys(zip.files)
            .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const blocks = [];
        for (const [k, file] of sheetFiles.entries()) {
            const sheet = await parse(file);
            if (!sheet)
                continue;
            const rows = Array.from(sheet.getElementsByTagNameNS(S_NS, "row"))
                .map((row) => Array.from(row.getElementsByTagNameNS(S_NS, "c")).map((c) => cellText(c, shared).trim()).filter((t) => t !== "").join("  |  "))
                .filter((r) => r !== "");
            if (rows.length === 0)
                continue;
            if (blocks.length > 0)
                blocks.push({ text: "", kind: "break" });
            blocks.push({ text: names.length === sheetFiles.length ? names[k] : `Sheet ${k + 1}`, kind: "heading" });
            rows.forEach((r) => blocks.push({ text: r, kind: "row" }));
        }
        return blocks;
    }
    // Word, PowerPoint and Excel files are zip archives of XML.
    async function loadOoxml(file, kind) {
        if (!libs.JSZip)
            await loadScript(JSZIP_URL);
        const zipLib = libs.JSZip;
        if (!zipLib)
            throw new Error("The document reader failed to load.");
        const zip = await zipLib.loadAsync(await file.arrayBuffer());
        const wanted = (name) => {
            if (kind === "docx")
                return /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(name);
            if (kind === "pptx")
                return /^ppt\/slides\/slide\d+\.xml$/.test(name);
            return name === "xl/sharedStrings.xml";
        };
        const names = Object.keys(zip.files).filter(wanted).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        if (names.length === 0 && kind !== "xlsx")
            throw new Error(`This does not look like a valid .${kind} file.`);
        const parts = [];
        let sharedAll = [];
        for (const name of names) {
            const xml = new DOMParser().parseFromString(await zip.files[name].async("string"), "application/xml");
            if (xml.getElementsByTagName("parsererror").length > 0)
                continue; // leave an unreadable part alone
            if (kind === "xlsx") {
                const shared = sharedStringTexts(xml);
                sharedAll = shared.all;
                parts.push({ name, xml, slots: shared.slots });
            }
            else {
                parts.push({ name, xml, slots: paragraphSlots(xml, kind === "docx" ? W_NS : A_NS, name) });
            }
        }
        const slots = parts.flatMap((part) => part.slots);
        const flow = (translated) => {
            const blocks = [];
            let slide = "";
            slots.forEach((slot, i) => {
                if (kind === "docx" && slot.part !== "word/document.xml")
                    return; // headers and footers are translated, but not repeated in the PDF
                let blockKind = slot.kind ?? "body";
                if (kind === "pptx" && slot.part !== slide) {
                    if (slide)
                        blocks.push({ text: "", kind: "break" }); // one PDF page for each slide
                    slide = slot.part ?? "";
                    blockKind = "heading";
                }
                blocks.push({ text: translated[i] || slot.text, kind: blockKind });
            });
            return blocks;
        };
        return {
            units: slots.map((slot) => slot.text),
            note: "",
            async toPdf(translated) {
                let blocks;
                if (kind === "xlsx") {
                    const byRef = new Map();
                    slots.forEach((slot, i) => {
                        if (translated[i] && slot.ref !== undefined)
                            byRef.set(slot.ref, translated[i]);
                    });
                    blocks = await xlsxBlocks(zip, sharedAll.map((text, i) => byRef.get(i) ?? text));
                }
                else {
                    blocks = flow(translated);
                }
                if (blocks.length === 0)
                    blocks = [{ text: "(No text)", kind: "body" }];
                return renderFlowPdf(blocks, state.to === "ja");
            },
            sameFormat: {
                label: `.${kind}`,
                async build(translated) {
                    slots.forEach((slot, i) => {
                        if (translated[i])
                            slot.set(translated[i]);
                    });
                    for (const part of parts) {
                        let xml = new XMLSerializer().serializeToString(part.xml);
                        if (!xml.startsWith("<?xml"))
                            xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + xml;
                        zip.file(part.name, xml);
                    }
                    const blob = await zip.generateAsync({ type: "blob", mimeType: OOXML_MIME[kind], compression: "DEFLATE" });
                    return { blob, filename: translatedName(file.name, kind) };
                },
            },
        };
    }
    /* ----- PDF ----- */
    // Pieces of text on a PDF page as top-down boxes, so they can be grouped like text found in a picture.
    function pdfPieces(items, top) {
        const words = items
            .filter((i) => typeof i.str === "string" && i.str.trim() !== "")
            .map((i) => ({ str: i.str.trim(), x: i.transform[4], y: i.transform[5], w: i.width, h: Math.abs(i.transform[3]) || 10 }));
        words.sort((a, b) => b.y - a.y);
        const pieces = [];
        for (let i = 0; i < words.length;) {
            const row = [words[i++]];
            while (i < words.length && Math.abs(words[i].y - row[0].y) < Math.max(2, 0.4 * row[0].h))
                row.push(words[i++]);
            row.sort((a, b) => a.x - b.x);
            // Words far apart on one line belong to different columns or cells.
            const segments = [[row[0]]];
            for (let k = 1; k < row.length; k++) {
                const prev = row[k - 1];
                if (row[k].x - (prev.x + prev.w) > 1.6 * Math.max(prev.h, row[k].h))
                    segments.push([row[k]]);
                else
                    segments[segments.length - 1].push(row[k]);
            }
            for (const seg of segments) {
                const h = Math.max(...seg.map((w) => w.h));
                const y = seg[0].y;
                let text = seg[0].str;
                for (let k = 1; k < seg.length; k++) {
                    text += (seg[k].x - (seg[k - 1].x + seg[k - 1].w) > 0.2 * h ? " " : "") + seg[k].str;
                }
                if (!/[\p{L}\p{N}]/u.test(text))
                    continue;
                pieces.push({
                    text,
                    x0: seg[0].x,
                    x1: seg[seg.length - 1].x + seg[seg.length - 1].w,
                    y0: top - (y + 0.92 * h),
                    y1: top - (y - 0.22 * h),
                });
            }
        }
        return pieces;
    }
    async function loadPdf(file) {
        if (!libs.pdfjsLib)
            await loadScript(PDFJS_URL);
        const pdfjs = libs.pdfjsLib;
        if (!pdfjs)
            throw new Error("The PDF reader failed to load.");
        pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        const original = await file.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: original.slice(0) }).promise; // pdf.js takes the buffer it is given, so it gets a copy
        const regions = [];
        const tops = [];
        let skipped = 0;
        for (let n = 1; n <= pdf.numPages; n++) {
            docStatus(`Reading page ${n} of ${pdf.numPages}…`);
            const page = await pdf.getPage(n);
            if ((page.rotate || 0) % 360 !== 0) {
                skipped++;
                continue;
            }
            tops[n - 1] = page.view[3];
            const found = groupPieces(pdfPieces((await page.getTextContent()).items, page.view[3]), state.from, 0.3);
            found.forEach((r) => regions.push({ ...r, page: n - 1 }));
        }
        return {
            units: regions.map((r) => r.text),
            note: skipped > 0 ? `${skipped} rotated page${skipped > 1 ? "s were" : " was"} left as they were.` : "",
            toPdf: (translated) => overlayPdf(original, regions, tops, translated),
        };
    }
    async function loadText(file) {
        const units = (await file.text())
            .split(/\r?\n\s*\n/)
            .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
            .filter((p) => p !== "");
        return {
            units,
            note: "",
            toPdf: (translated) => renderFlowPdf(units.map((u, i) => ({ text: translated[i] || u, kind: "body" })), state.to === "ja"),
            sameFormat: {
                label: ".txt",
                build: async (translated) => ({
                    blob: new Blob([units.map((u, i) => translated[i] || u).join("\n\n")], { type: "text/plain;charset=utf-8" }),
                    filename: translatedName(file.name, "txt"),
                }),
            },
        };
    }
    // Translates four paragraphs at a time. Identical text is translated once, and numbers,
    // addresses and anything that fails are left as they are. Returns "" for "no change".
    async function translateUnits(texts, run) {
        const out = texts.map(() => "");
        const jobs = new Map();
        texts.slice(0, MAX_DOC_UNITS).forEach((text, i) => {
            const clean = text.trim();
            if (leaveAlone(clean))
                return;
            jobs.set(clean, [...(jobs.get(clean) ?? []), i]);
        });
        const queue = [...jobs.entries()];
        let next = 0;
        let done = 0;
        let failed = 0;
        const worker = async () => {
            while (next < queue.length && run === docRun) {
                const [text, indexes] = queue[next++];
                try {
                    const translated = await translatePiece(text);
                    if (normText(translated) !== normText(text))
                        indexes.forEach((i) => (out[i] = translated));
                }
                catch {
                    failed++;
                }
                done++;
                if (run === docRun)
                    docStatus(`Translating… ${done} of ${queue.length}`);
            }
        };
        await Promise.all(Array.from({ length: DOC_CONCURRENCY }, () => worker()));
        if (queue.length > 0 && failed === queue.length)
            throw new Error("Translation failed. Check your connection and try again.");
        return out;
    }
    function saveBlob(url, filename) {
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
    }
    function showDocument(file, built, note, alt) {
        if (docUrl)
            URL.revokeObjectURL(docUrl);
        docResult = built;
        docUrl = URL.createObjectURL(built.blob);
        docAlt = alt ? alt.build : null;
        el.docName.textContent = file.name;
        el.docSize.textContent = formatSize(file.size);
        el.docNote.textContent = note;
        el.docNote.hidden = note === "";
        el.docAlt.hidden = !alt;
        if (alt)
            el.docAlt.textContent = `Also download as ${alt.label}`;
        el.docView.hidden = false;
        el.uploadPanel.hidden = true;
    }
    async function processDocument(file) {
        const run = ++docRun;
        currentDocFile = file;
        el.docView.hidden = true;
        el.uploadPanel.hidden = false;
        try {
            if (file.size > MAX_DOC_BYTES)
                throw new Error("That file is larger than 25 MB.");
            const kind = docKind(file.name);
            docStatus(`Reading ${file.name}…`);
            const doc = kind === "pdf" ? await loadPdf(file) : kind === "txt" ? await loadText(file) : await loadOoxml(file, kind);
            if (run !== docRun)
                return;
            if (doc.units.length === 0) {
                docStatus(kind === "pdf" ? "No text found. A scanned PDF is a picture, so try the Images tab." : "No text was found in that file.");
                return;
            }
            const translated = await translateUnits(doc.units, run);
            if (run !== docRun)
                return;
            docStatus("Creating the PDF…");
            const bytes = await doc.toPdf(translated);
            if (run !== docRun)
                return;
            const built = {
                blob: new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
                filename: translatedName(file.name, "pdf"),
            };
            const limit = doc.units.length > MAX_DOC_UNITS ? `Only the first ${MAX_DOC_UNITS} blocks of text were translated. ` : "";
            const sameFormat = doc.sameFormat;
            showDocument(file, built, (limit + doc.note).trim(), sameFormat ? { label: sameFormat.label, build: () => sameFormat.build(translated) } : null);
            docStatus(DOC_HINT);
        }
        catch (err) {
            if (run === docRun)
                docStatus(err instanceof Error ? err.message : "Could not translate that document.");
        }
    }
    function closeDocument() {
        docRun++;
        currentDocFile = null;
        docResult = null;
        docAlt = null;
        if (docUrl)
            URL.revokeObjectURL(docUrl);
        docUrl = "";
        el.docView.hidden = true;
        el.uploadPanel.hidden = false;
        docStatus(DOC_HINT);
    }
    el.docClose.addEventListener("click", closeDocument);
    el.docDownload.addEventListener("click", () => {
        if (docResult && docUrl)
            saveBlob(docUrl, docResult.filename);
    });
    el.docOpen.addEventListener("click", () => {
        if (docUrl)
            window.open(docUrl, "_blank");
    });
    el.docAlt.addEventListener("click", async () => {
        if (!docAlt)
            return;
        try {
            const alt = await docAlt();
            const url = URL.createObjectURL(alt.blob);
            saveBlob(url, alt.filename);
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        catch {
            docStatus("Could not create that file.");
        }
    });
    /* ---------- Japanese typed in English letters (romaji), and pronunciation under Japanese input ---------- */
    const ROMAJI = {};
    (() => {
        const vowels = ["a", "i", "u", "e", "o"];
        const rows = [
            ["", "あいうえお"], ["k", "かきくけこ"], ["s", "さしすせそ"], ["t", "たちつてと"], ["n", "なにぬねの"],
            ["h", "はひふへほ"], ["m", "まみむめも"], ["y", "や　ゆ　よ"], ["r", "らりるれろ"], ["w", "わ　　　を"],
            ["g", "がぎぐげご"], ["z", "ざじずぜぞ"], ["d", "だぢづでど"], ["b", "ばびぶべぼ"], ["p", "ぱぴぷぺぽ"],
        ];
        for (const [c, kana] of rows)
            vowels.forEach((v, i) => { if (kana[i] !== "　")
                ROMAJI[c + v] = kana[i]; });
        const small = [["ya", "ゃ"], ["yu", "ゅ"], ["yo", "ょ"]];
        const i_row = { k: "き", g: "ぎ", s: "し", z: "じ", j: "じ", t: "ち", d: "ぢ", n: "に", h: "ひ", b: "び", p: "ぴ", m: "み", r: "り" };
        for (const [c, base] of Object.entries(i_row))
            for (const [y, k] of small)
                ROMAJI[c + y] = base + k;
        Object.assign(ROMAJI, {
            shi: "し", sha: "しゃ", shu: "しゅ", sho: "しょ", she: "しぇ", chi: "ち", cha: "ちゃ", chu: "ちゅ", cho: "ちょ", che: "ちぇ",
            tsu: "つ", ji: "じ", ja: "じゃ", ju: "じゅ", jo: "じょ", je: "じぇ", fu: "ふ", fa: "ふぁ", fi: "ふぃ", fe: "ふぇ", fo: "ふぉ",
            si: "し", ti: "ち", tu: "つ", hu: "ふ", zi: "じ", wi: "うぃ", we: "うぇ", wu: "う", jya: "じゃ", jyu: "じゅ", jyo: "じょ",
            xa: "ぁ", xi: "ぃ", xu: "ぅ", xe: "ぇ", xo: "ぉ", xya: "ゃ", xyu: "ゅ", xyo: "ょ", xtu: "っ", xtsu: "っ", // l-prefixed small kana are left out so English words (hello, play) are not turned into kana
        });
    })();
    const ROMAJI_KEYS = Object.keys(ROMAJI);
    const isPendingRomaji = (rest) => rest.length < 4 && ROMAJI_KEYS.some((k) => k.length > rest.length && k.startsWith(rest));
    // One word typed in English letters, turned into hiragana the way a Japanese keyboard would.
    function convertRomajiWord(w) {
        let out = "";
        let leftover = false;
        let i = 0;
        while (i < w.length) {
            const c = w[i];
            const rest = w.slice(i);
            if (c === "-") {
                out += "ー";
                i++;
                continue;
            }
            if (c === "'") {
                i++;
                continue;
            }
            if (i + 1 < w.length && c === w[i + 1] && "bcdfghjklmpqrstvwxyz".includes(c)) {
                out += "っ";
                i++;
                continue;
            } // kitte -> きって
            if (rest.startsWith("tch")) {
                out += "っ";
                i++;
                continue;
            }
            if (c === "n") {
                const next = w[i + 1];
                if (next === undefined) {
                    out += "ん";
                    i++;
                    continue;
                }
                if (next === "'") {
                    out += "ん";
                    i += 2;
                    continue;
                }
                if (next === "n") {
                    const after = w[i + 2];
                    if (after !== undefined && /[aiueoy]/.test(after)) {
                        out += "ん";
                        i++;
                    } // konnichiwa: ん + に
                    else {
                        out += "ん";
                        i += 2;
                    }
                    continue;
                }
                if (!/[aiueoy]/.test(next)) {
                    out += "ん";
                    i++;
                    continue;
                } // kanji -> かんじ
            }
            let matched = false;
            for (let len = Math.min(4, rest.length); len >= 1; len--) {
                const kana = ROMAJI[rest.slice(0, len)];
                if (kana) {
                    out += kana;
                    i += len;
                    matched = true;
                    break;
                }
            }
            if (matched)
                continue;
            if (isPendingRomaji(rest))
                return { kana: out, pending: rest, leftover };
            leftover = true;
            out += c;
            i++;
        }
        return { kana: out, pending: "", leftover };
    }
    const JP_PUNCT = { ".": "。", ",": "、", "?": "？", "!": "！" };
    // Everyday words and phrases. A close misspelling of one of these ("konichiwa") is corrected before translating.
    const JA_PHRASES = [
        "こんにちは", "こんばんは", "おはよう", "おはようございます", "おやすみなさい", "おやすみ", "さようなら", "じゃあね", "またね", "ありがとう",
        "ありがとうございます", "ありがとうございました", "どうもありがとうございます", "どういたしまして", "すみません", "ごめんなさい", "ごめん",
        "おねがいします", "おねがい", "ください", "はい", "いいえ", "ええ", "だいじょうぶ", "いただきます", "ごちそうさまでした", "ただいま",
        "おかえりなさい", "いってきます", "いってらっしゃい", "はじめまして", "よろしくおねがいします", "おげんきですか", "げんきです",
        "おひさしぶりです", "おめでとう", "おめでとうございます", "おつかれさまです", "おつかれさま", "がんばって", "がんばります",
        "しつれいします", "わかりました", "わかりません", "しりません", "たすけて", "ちょっとまってください", "もういちどおねがいします",
        "ゆっくりおねがいします", "えいごをはなせますか", "にほんごがわかりません", "いくらですか", "どこですか", "トイレはどこですか",
        "おいしい", "すごい", "かわいい", "たのしい", "うれしい", "かなしい", "だいすき", "きらい", "あいしてる", "わたしのなまえは",
        "いらっしゃいませ", "どうぞ", "どうも", "そうですか", "そうです", "もちろん", "ほんとうですか", "なんですか", "だれですか", "いつですか",
        "どうしてですか", "いくつですか", "どれですか", "しつれいしました", "おまたせしました", "きをつけて", "おだいじに", "たのしんでね",
    ];
    // A spelling-tolerant key: katakana and hiragana alike, は=わ, を=お, no ん, long vowels and small kana ignored.
    function kanaKey(text) {
        return text
            .normalize("NFKC")
            .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
            .replace(/[\s、。！？!?.,ー・]/g, "")
            .replace(/[ぁぃぅぇぉゃゅょっん]/g, "")
            .replace(/を/g, "お")
            .replace(/は/g, "わ")
            .replace(/へ/g, "え")
            .replace(/づ/g, "ず")
            .replace(/ぢ/g, "じ")
            .replace(/([おこそとのほもよろ])う/g, "$1")
            .replace(/([えけせてねへめれ])い/g, "$1");
    }
    const PHRASE_KEYS = JA_PHRASES.map((p) => [kanaKey(p), p]);
    function editDistance(a, b) {
        const row = Array.from({ length: b.length + 1 }, (_, j) => j);
        for (let i = 1; i <= a.length; i++) {
            let prev = row[0];
            row[0] = i;
            for (let j = 1; j <= b.length; j++) {
                const keep = row[j];
                row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
                prev = keep;
            }
        }
        return row[b.length];
    }
    // The proper spelling of a known phrase, or null. Only whole inputs written in kana are considered.
    function canonicalPhrase(text) {
        const key = kanaKey(text);
        if (key.length < 2)
            return null;
        let best = null;
        let bestDistance = 99;
        for (const [k, phrase] of PHRASE_KEYS) {
            const d = k === key ? 0 : key.length >= 5 && Math.abs(k.length - key.length) <= 1 ? editDistance(k, key) : 99;
            if (d < bestDistance) {
                bestDistance = d;
                best = phrase;
            }
        }
        return bestDistance <= 1 ? best : null;
    }
    // Text typed while Japanese is the language on the left. Words written in English letters become
    // kana; a word that is not Japanese (Windows, iPhone) stays as it is. "send" is what gets translated.
    function prepareJapanese(raw) {
        const text = raw.normalize("NFKC"); // full-width letters and half-width katakana become normal
        const tokens = text.match(/[A-Za-z][A-Za-z'’-]*|[^A-Za-z]+/g) ?? [];
        const isWord = (t) => /^[A-Za-z]/.test(t);
        const words = tokens.filter(isWord).length;
        const lastWord = tokens.map(isWord).lastIndexOf(true);
        let converted = false;
        const send = [];
        const display = [];
        tokens.forEach((tok, i) => {
            if (!isWord(tok)) {
                send.push(tok);
                display.push(tok);
                return;
            }
            const lower = tok.toLowerCase().replace(/’/g, "'");
            // On their own between other words, wa / o / e are almost always the particles は / を / へ.
            const particle = words > 1 ? { wa: "は", o: "を", e: "へ" }[lower] : undefined;
            if (particle) {
                converted = true;
                send.push(particle);
                display.push(particle);
                return;
            }
            const r = convertRomajiWord(lower);
            const finished = !r.leftover && (r.pending === "" || i === lastWord);
            if (!finished || r.kana === "") {
                send.push(tok);
                display.push(tok);
                return;
            }
            converted = true;
            send.push(r.kana); // a half-typed ending (like the w in konnichiw) is not translated yet
            display.push(r.kana + r.pending);
        });
        const punct = (t) => t.replace(/(?<=[\u3040-\u30ff])[.,?!]/g, (m) => JP_PUNCT[m] ?? m);
        let sendText = punct(send.join(""));
        if (converted)
            sendText = sendText.replace(/(?<=[\u3040-\u30ff])\s+(?=[\u3040-\u30ff])/g, ""); // Japanese is written without spaces
        let shown = punct(display.join(""));
        let corrected = false;
        // Whole input in kana and a close match to a known phrase: use the proper spelling.
        const parts = sendText.match(/^([\u3040-\u30ffー]+)([、。！？!?.,\s]*)$/);
        if (parts) {
            const canon = canonicalPhrase(parts[1]);
            if (canon !== null) {
                corrected = canon !== parts[1];
                sendText = canon + parts[2].trim();
                if (corrected)
                    shown = sendText;
            }
        }
        return { send: sendText, display: shown, converted, corrected };
    }
    // Under Japanese input: the kana for what was typed in English letters (click to use it),
    // or the pronunciation in English letters for Japanese that was typed or pasted.
    let kanaTimer;
    let kanaUse = "";
    function renderKanaLine() {
        window.clearTimeout(kanaTimer);
        const text = el.input.value.trim();
        const hide = () => {
            kanaUse = "";
            el.kanaLine.hidden = true;
            el.kanaLine.textContent = "";
        };
        if (state.from !== "ja" || text === "")
            return hide();
        const jp = prepareJapanese(text);
        if (jp.converted || jp.corrected) {
            kanaUse = jp.send;
            el.kanaLine.textContent = jp.display;
            el.kanaLine.disabled = false;
            el.kanaLine.title = "Use this text";
            el.kanaLine.hidden = false;
            return;
        }
        kanaUse = "";
        if (text.length > 200 || !/[\u3040-\u30ff\u4e00-\u9fff]/.test(text))
            return hide();
        kanaTimer = window.setTimeout(async () => {
            const romaji = await fetchRomaji(text);
            if (el.input.value.trim() !== text || state.from !== "ja")
                return;
            el.kanaLine.textContent = romaji;
            el.kanaLine.disabled = true;
            el.kanaLine.title = "";
            el.kanaLine.hidden = romaji === "";
        }, 400);
    }
    el.kanaLine.addEventListener("click", () => {
        if (!kanaUse)
            return;
        el.input.value = kanaUse;
        el.input.focus();
        fireInput();
    });
    /* ---------- Light and dark theme ---------- */
    const THEME_KEY = "kotoba-theme";
    const systemDark = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    function effectiveTheme() {
        const chosen = document.documentElement.dataset.theme;
        if (chosen === "light" || chosen === "dark")
            return chosen;
        return systemDark?.matches ? "dark" : "light";
    }
    function showTheme() {
        const theme = effectiveTheme();
        const next = theme === "dark" ? "light" : "dark";
        el.themeToggle.dataset.mode = theme; // the sun shows in the light theme, the moon in the dark one
        el.themeToggle.title = `Switch to ${next} theme`;
        el.themeToggle.setAttribute("aria-label", `Switch to ${next} theme`);
    }
    el.themeToggle.addEventListener("click", () => {
        const next = effectiveTheme() === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        try {
            localStorage.setItem(THEME_KEY, next);
        }
        catch {
            /* the choice just will not be remembered */
        }
        showTheme();
    });
    systemDark?.addEventListener("change", showTheme); // until a theme is chosen, follow the computer's setting
    showTheme();
    /* ---------- events ---------- */
    el.swap.addEventListener("click", swap);
    el.clear.addEventListener("click", () => {
        if (wantListening)
            stopListening(false);
        window.clearTimeout(timer);
        seq++;
        hideLookup();
        el.input.value = "";
        state.lastSource = "";
        state.lastResult = "";
        showOutput("Your translation appears here.", true);
        setStatus();
        updateCount();
        el.input.focus();
    });
    el.input.addEventListener("input", () => {
        if (wantListening)
            stopListening(false); // typing by hand takes over from the microphone
        updateCount();
        renderKanaLine();
        scheduleTranslate();
    });
    el.input.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            void translate();
        }
    });
    el.speakFrom.addEventListener("click", () => speak(el.input.value.trim(), state.from));
    el.speakTo.addEventListener("click", () => speak(state.lastResult, state.to));
    el.copy.addEventListener("click", () => void copyResult());
    el.save.addEventListener("click", saveCurrent);
    el.historyBtn.addEventListener("click", () => togglePanel("history"));
    el.savedBtn.addEventListener("click", () => togglePanel("saved"));
    el.drawerClear.addEventListener("click", () => {
        saveList(HISTORY_KEY, []);
        renderDrawer();
    });
    if ("speechSynthesis" in window)
        window.speechSynthesis.getVoices(); // warm up voice list
    applyDirection();
    showOutput("Your translation appears here.", true);
    updateCount();
    if (missingIds.length > 0) {
        const banner = document.createElement("div");
        banner.className = "stale-banner";
        banner.textContent = `This page is out of date (missing ${missingIds.map((i) => "#" + i).join(", ")}). Replace public/index.html with the latest index.html, then refresh.`;
        document.body.prepend(banner);
    }
})();
