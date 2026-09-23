"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type CallState =
  | "idle"
  | "speaking"
  | "listening"
  | "processing"
  | "ended";

type RecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
};

const GREETING =
  "Hello, I’m EMMA, the AI receptionist for the surgery. How can I help you today?";

const END_PHRASES = [
  "that's all",
  "thats all",
  "that's it",
  "thats it",
  "no that's all",
  "no thats all",
  "we can end the call",
  "end the call",
  "please end the call",
  "you can end the call",
  "goodbye",
  "good bye",
  "bye",
  "nothing else",
  "no more questions",
  "that's everything",
  "thats everything",
  "nothing more",
  "no that's everything",
  "no thats everything",
];

export default function Home() {
  const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000";
  
  const [callState, setCallState] =
    useState<CallState>("idle");

  const [history, setHistory] = useState<Message[]>([
    {
      role: "assistant",
      content: GREETING,
    },
  ]);

  const [intent, setIntent] =
    useState("Waiting for patient");

  const [nextAction, setNextAction] =
    useState("Start conversation");

  const [safetyStatus, setSafetyStatus] =
    useState("Ready");

  const [knowledgeStatus, setKnowledgeStatus] =
    useState("Not required");

  const [workflowTitle, setWorkflowTitle] =
    useState("Ready to start");

  const [workflowDescription, setWorkflowDescription] =
    useState(
      "EMMA will greet the patient and wait for their request."
    );

  const [callStartedAt, setCallStartedAt] =
    useState<number | null>(null);

  const [callDuration, setCallDuration] =
    useState("00:00");

  /*
   * -------------------------------------------------
   * REFS
   * -------------------------------------------------
   */

  const recognitionRef =
    useRef<RecognitionInstance | null>(null);

  const historyRef =
    useRef<Message[]>([
      {
        role: "assistant",
        content: GREETING,
      },
    ]);

  const callStateRef =
    useRef<CallState>("idle");

  const conversationEndRef =
    useRef<HTMLDivElement | null>(null);

  /*
   * Voice state.
   */

  const isSpeakingRef =
    useRef(false);

  const isProcessingRef =
    useRef(false);

  const shouldListenRef =
    useRef(false);

  const startingRecognitionRef =
    useRef(false);

  /*
   * Used when EMMA is saying goodbye.
   */

  const endingCallRef =
    useRef(false);

  /*
   * -------------------------------------------------
   * SPEECH RECOGNITION PROTECTION
   * -------------------------------------------------
   *
   * Each recognition instance gets a unique session ID.
   * This prevents old browser events from interfering
   * with newer recognition instances.
   */

  const recognitionSessionRef =
    useRef(0);

  /*
   * Restarts recognition if Chrome becomes unresponsive.
   */

  const listeningWatchdogRef =
    useRef<number | null>(null);

  /*
   * Prevents multiple restart timers.
   */

  const recognitionRestartTimerRef =
    useRef<number | null>(null);

  /*
   * Holds the latest startListening function.
   *
   * This avoids circular useCallback dependencies.
   */

  const startListeningRef =
    useRef<(() => void) | null>(null);

  /*
   * -------------------------------------------------
   * KEEP REFS SYNCHRONIZED
   * -------------------------------------------------
   */

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  /*
   * -------------------------------------------------
   * AUTO-SCROLL CONVERSATION
   * -------------------------------------------------
   */

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [history]);

  /*
   * -------------------------------------------------
   * CALL DURATION
   * -------------------------------------------------
   */

  useEffect(() => {
    if (
      !callStartedAt ||
      callState === "ended"
    ) {
      return;
    }

    const updateDuration = () => {
      const elapsed = Math.floor(
        (Date.now() - callStartedAt) / 1000
      );

      const minutes = Math.floor(
        elapsed / 60
      )
        .toString()
        .padStart(2, "0");

      const seconds = (
        elapsed % 60
      )
        .toString()
        .padStart(2, "0");

      setCallDuration(
        `${minutes}:${seconds}`
      );
    };

    updateDuration();

    const timer =
      window.setInterval(
        updateDuration,
        1000
      );

    return () =>
      window.clearInterval(timer);
  }, [callStartedAt, callState]);

  /*
   * -------------------------------------------------
   * CLEAR WATCHDOG
   * -------------------------------------------------
   */

  const clearListeningWatchdog =
    useCallback(() => {
      if (
        listeningWatchdogRef.current !==
        null
      ) {
        window.clearTimeout(
          listeningWatchdogRef.current
        );

        listeningWatchdogRef.current =
          null;
      }
    }, []);

  /*
   * -------------------------------------------------
   * CLEAR RESTART TIMER
   * -------------------------------------------------
   */

  const clearRecognitionRestartTimer =
    useCallback(() => {
      if (
        recognitionRestartTimerRef.current !==
        null
      ) {
        window.clearTimeout(
          recognitionRestartTimerRef.current
        );

        recognitionRestartTimerRef.current =
          null;
      }
    }, []);

  /*
   * -------------------------------------------------
   * STOP RECOGNITION
   * -------------------------------------------------
   */

  const stopRecognition =
    useCallback(() => {
      /*
       * Invalidate all callbacks belonging to
       * the current recognition instance.
       */
      recognitionSessionRef.current += 1;

      shouldListenRef.current = false;

      startingRecognitionRef.current =
        false;

      clearListeningWatchdog();

      clearRecognitionRestartTimer();

      const recognition =
        recognitionRef.current;

      recognitionRef.current = null;

      if (!recognition) {
        return;
      }

      try {
        recognition.abort();
      } catch {
        // Recognition may already be stopped.
      }
    }, [
      clearListeningWatchdog,
      clearRecognitionRestartTimer,
    ]);

  /*
   * -------------------------------------------------
   * SCHEDULE RECOGNITION RESTART
   * -------------------------------------------------
   */

  const scheduleListeningRestart =
    useCallback((delay = 300) => {
      /*
       * Do not restart when the call shouldn't
       * currently be listening.
       */
      if (
        callStateRef.current === "ended" ||
        !shouldListenRef.current ||
        isSpeakingRef.current ||
        isProcessingRef.current
      ) {
        return;
      }

      /*
       * Don't create multiple timers.
       */
      if (
        recognitionRestartTimerRef.current !==
        null
      ) {
        return;
      }

      recognitionRestartTimerRef.current =
        window.setTimeout(() => {
          recognitionRestartTimerRef.current =
            null;

          if (
            callStateRef.current ===
              "ended" ||
            !shouldListenRef.current ||
            isSpeakingRef.current ||
            isProcessingRef.current ||
            recognitionRef.current ||
            startingRecognitionRef.current
          ) {
            return;
          }

          console.log(
            "Restarting speech recognition..."
          );

          startListeningRef.current?.();
        }, delay);
    }, []);

  /*
   * -------------------------------------------------
   * END CALL
   * -------------------------------------------------
   */

  const endCall = useCallback(() => {
    shouldListenRef.current = false;

    isProcessingRef.current = false;

    isSpeakingRef.current = false;

    startingRecognitionRef.current =
      false;

    endingCallRef.current = false;

    /*
     * Invalidate recognition sessions.
     */
    recognitionSessionRef.current += 1;

    stopRecognition();

    /*
     * Stop TTS.
     */
    if (
      "speechSynthesis" in window
    ) {
      window.speechSynthesis.cancel();
    }

    setCallState("ended");

    callStateRef.current = "ended";

    setIntent("call_end");

    setNextAction("Call ended");

    setKnowledgeStatus(
      "Not required"
    );

    setSafetyStatus("Clear");

    setWorkflowTitle(
      "Call ended"
    );

    setWorkflowDescription(
      "The conversation has been completed. Start a new call when you are ready."
    );
  }, [stopRecognition]);

  /*
   * -------------------------------------------------
   * END PHRASE DETECTION
   * -------------------------------------------------
   */

  const isEndPhrase = (
    text: string
  ) => {
    const normalized = text
      .toLowerCase()
      .replace(/[.,!?]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    return END_PHRASES.some(
      (phrase) =>
        normalized.includes(phrase)
    );
  };

  /*
   * -------------------------------------------------
   * TEXT TO SPEECH
   * -------------------------------------------------
   */

  const speakText = useCallback(
    (
      text: string,
      onFinished?: () => void
    ) => {
      if (!text.trim()) {
        onFinished?.();
        return;
      }

      if (
        !("speechSynthesis" in window)
      ) {
        onFinished?.();
        return;
      }

      /*
       * Cancel previous speech.
       */
      window.speechSynthesis.cancel();

      const utterance =
        new SpeechSynthesisUtterance(
          text
        );

      utterance.lang = "en-GB";

      utterance.rate = 0.95;

      utterance.pitch = 1;

      utterance.volume = 1;

      /*
       * Prefer British English voice.
       */
      const voices =
        window.speechSynthesis.getVoices();

      const preferredVoice =
        voices.find(
          (voice) =>
            voice.lang.toLowerCase() ===
            "en-gb"
        ) ||
        voices.find((voice) =>
          voice.lang
            .toLowerCase()
            .startsWith("en-gb")
        );

      if (preferredVoice) {
        utterance.voice =
          preferredVoice;
      }

      isSpeakingRef.current = true;

      /*
       * Stop recognition while EMMA speaks.
       */
      if (
        recognitionRef.current
      ) {
        const recognition =
          recognitionRef.current;

        recognitionRef.current = null;

        recognitionSessionRef.current +=
          1;

        try {
          recognition.abort();
        } catch {}
      }

      startingRecognitionRef.current =
        false;

      clearListeningWatchdog();

      setCallState("speaking");

      callStateRef.current =
        "speaking";

      setWorkflowTitle(
        endingCallRef.current
          ? "EMMA is saying goodbye"
          : "EMMA is speaking"
      );

      setWorkflowDescription(
        endingCallRef.current
          ? "EMMA is finishing the call."
          : "EMMA is responding to the patient."
      );

      const finishSpeech = () => {
        isSpeakingRef.current = false;

        /*
         * If EMMA is finishing the call,
         * don't restart recognition.
         */
        if (
          endingCallRef.current
        ) {
          onFinished?.();
          return;
        }

        /*
         * Manual end call.
         */
        if (
          callStateRef.current ===
            "ended" ||
          !shouldListenRef.current
        ) {
          onFinished?.();
          return;
        }

        onFinished?.();

        /*
         * Wait briefly before opening the
         * microphone again.
         */
        window.setTimeout(() => {
          if (
            callStateRef.current !==
              "ended" &&
            shouldListenRef.current &&
            !isSpeakingRef.current &&
            !isProcessingRef.current &&
            !recognitionRef.current &&
            !startingRecognitionRef.current
          ) {
            startListeningRef.current?.();
          }
        }, 350);
      };

      utterance.onend =
        finishSpeech;

      utterance.onerror = () => {
        console.warn(
          "Speech synthesis error."
        );

        finishSpeech();
      };

      window.speechSynthesis.speak(
        utterance
      );
    },
    [clearListeningWatchdog]
  );

  /*
   * -------------------------------------------------
   * START LISTENING
   * -------------------------------------------------
   */

  const startListening =
    useCallback(() => {
      /*
       * Prevent duplicate recognition sessions.
       */
      if (
        callStateRef.current ===
          "ended" ||
        isSpeakingRef.current ||
        isProcessingRef.current ||
        !shouldListenRef.current ||
        startingRecognitionRef.current ||
        recognitionRef.current
      ) {
        return;
      }

      const SpeechRecognition =
        (window as any)
          .SpeechRecognition ||
        (window as any)
          .webkitSpeechRecognition;

      if (!SpeechRecognition) {
        alert(
          "Speech recognition is not supported in this browser. Please use Chrome."
        );

        endCall();

        return;
      }

      /*
       * Clear old timers.
       */
      clearListeningWatchdog();

      clearRecognitionRestartTimer();

      /*
       * Create a unique session.
       */
      const sessionId =
        recognitionSessionRef.current +
        1;

      recognitionSessionRef.current =
        sessionId;

      startingRecognitionRef.current =
        true;

      const recognition =
        new SpeechRecognition() as RecognitionInstance;

      recognition.continuous = false;

      recognition.interimResults =
        false;

      recognition.lang = "en-GB";

      recognitionRef.current =
        recognition;

      /*
       * -------------------------------------------------
       * LISTENING UI
       * -------------------------------------------------
       */

      setCallState("listening");

      callStateRef.current =
        "listening";

      setWorkflowTitle(
        "Waiting for patient"
      );

      setWorkflowDescription(
        "EMMA is listening for the patient's response."
      );

      console.log(
        `Speech recognition started. Session ${sessionId}`
      );

      /*
       * -------------------------------------------------
       * WATCHDOG
       * -------------------------------------------------
       *
       * If Chrome produces no result and does not
       * properly end the session for 15 seconds,
       * restart the microphone.
       */

      listeningWatchdogRef.current =
        window.setTimeout(() => {
          /*
           * Ignore stale watchdog.
           */
          if (
            sessionId !==
            recognitionSessionRef.current
          ) {
            return;
          }

          if (
            callStateRef.current !==
              "listening" ||
            !shouldListenRef.current ||
            isSpeakingRef.current ||
            isProcessingRef.current
          ) {
            return;
          }

          console.warn(
            "Speech recognition watchdog triggered."
          );

          /*
           * Invalidate this session.
           */
          recognitionSessionRef.current +=
            1;

          recognitionRef.current =
            null;

          startingRecognitionRef.current =
            false;

          clearListeningWatchdog();

          try {
            recognition.abort();
          } catch {}

          setWorkflowTitle(
            "Reconnecting microphone"
          );

          setWorkflowDescription(
            "EMMA is restarting speech recognition."
          );

          scheduleListeningRestart(
            300
          );
        }, 15000);

      /*
       * -------------------------------------------------
       * RESULT
       * -------------------------------------------------
       */



      recognition.onresult = async (
        event: any
      ) => {
        /*
         * Ignore stale result.
         */
        if (
          sessionId !==
          recognitionSessionRef.current
        ) {
          return;
        }

        startingRecognitionRef.current =
          false;

        clearListeningWatchdog();

        const text =
          event?.results?.[0]?.[0]
            ?.transcript
            ?.trim() || "";

        /*
         * Empty result.
         */
        if (!text) {
          console.log(
            "Speech recognition returned an empty result."
          );

          recognitionSessionRef.current +=
            1;

          recognitionRef.current =
            null;

          try {
            recognition.abort();
          } catch {}

          scheduleListeningRestart(
            300
          );

          return;
        }

        console.log(
          "Speech recognized:",
          text
        );

        /*
         * Invalidate this recognition instance
         * before aborting it.
         *
         * This is critical because abort() can
         * trigger onend.
         */
        recognitionSessionRef.current +=
          1;

        recognitionRef.current =
          null;

        try {
          recognition.abort();
        } catch {}

        /*
         * -------------------------------------------------
         * LOCAL END-CALL DETECTION
         * -------------------------------------------------
         */

        if (isEndPhrase(text)) {
          const goodbye =
            "You’re welcome. Thank you for calling the surgery. Have a good day!";

          const updatedHistory: Message[] =
            [
              ...historyRef.current,
              {
                role: "user",
                content: text,
              },
              {
                role: "assistant",
                content: goodbye,
              },
            ];

          historyRef.current =
            updatedHistory;

          setHistory(
            updatedHistory
          );

          setIntent("call_end");

          setNextAction(
            "Call ended"
          );

          setSafetyStatus("Clear");

          setKnowledgeStatus(
            "Not required"
          );

          /*
           * Do not listen again.
           */
          shouldListenRef.current =
            false;

          endingCallRef.current =
            true;

          setCallState("speaking");

          callStateRef.current =
            "speaking";

          setWorkflowTitle(
            "EMMA is saying goodbye"
          );

          setWorkflowDescription(
            "EMMA is finishing the call."
          );

          speakText(
            goodbye,
            () => {
              endCall();
            }
          );

          return;
        }

        /*
         * -------------------------------------------------
         * BACKEND PROCESSING
         * -------------------------------------------------
         */

        isProcessingRef.current =
          true;

        setCallState("processing");

        callStateRef.current =
          "processing";

        setIntent(
          "Processing request"
        );

        setNextAction(
          "Sending request to EMMA"
        );

        setWorkflowTitle(
          "Processing request"
        );

        setWorkflowDescription(
          "EMMA is understanding the patient's request."
        );

        const currentHistory =
          historyRef.current;

        try {
          const response =
            await fetch(
              `${API_BASE_URL}/api/analyze`,
              {
                method: "POST",

                headers: {
                  "Content-Type":
                    "application/json",
                },

                body: JSON.stringify({
                  transcript: text,
                  history:
                    currentHistory,
                }),
              }
            );

          if (!response.ok) {
            throw new Error(
              `Backend returned ${response.status}`
            );
          }

          const data =
            await response.json();

          const assistantResponse =
            typeof data.response ===
            "string"
              ? data.response.trim()
              : "";

          if (!assistantResponse) {
            throw new Error(
              "Backend returned an empty response"
            );
          }

          /*
           * Update conversation.
           */
          const updatedHistory: Message[] =
            [
              ...currentHistory,
              {
                role: "user",
                content: text,
              },
              {
                role: "assistant",
                content:
                  assistantResponse,
              },
            ];

          historyRef.current =
            updatedHistory;

          setHistory(
            updatedHistory
          );

          /*
           * Update AI activity.
           */
          setIntent(
            data.intent ||
              "unknown"
          );

          setNextAction(
            data.next_action ||
              "Continue conversation"
          );

          if (data.knowledge_retrieval?.length > 0) {
  const sources = [
    ...new Set(
      data.knowledge_retrieval.map(
        (item: {
          source: string;
          chunk_id: number;
          score: number;
        }) => item.source
      )
    ),
  ];

  setKnowledgeStatus(
    `${data.knowledge_retrieval.length} relevant chunk${
      data.knowledge_retrieval.length === 1 ? "" : "s"
    } from ${sources.join(", ")}`
  );
} else {
  setKnowledgeStatus("No relevant knowledge retrieved");
}

          setSafetyStatus(
            data.safety_status ||
              data.safety ||
              "Clear"
          );

          /*
           * -------------------------------------------------
           * EMERGENCY RESPONSE
           * -------------------------------------------------
           *
           * Emergency escalation must terminate the
           * conversation instead of returning to listening.
           *
           * Keep the emergency intent/safety state visible
           * in the UI rather than calling endCall(), which
           * would reset those values.
           * -------------------------------------------------
           */

          const isEmergency =
            data.safety === "escalate_999" ||
            data.intent === "emergency" ||
            data.next_action === "call_999";

          if (isEmergency) {
            shouldListenRef.current =
              false;

            endingCallRef.current =
              true;

            setCallState("speaking");

            callStateRef.current =
              "speaking";

            setWorkflowTitle(
              "Emergency escalation"
            );

            setWorkflowDescription(
              "EMMA has identified a potential emergency and is advising the patient to call 999."
            );

            setNextAction(
              "call_999"
            );

            speakText(
              assistantResponse,
              () => {
                stopRecognition();

                setCallState("ended");

                callStateRef.current =
                  "ended";

                setWorkflowTitle(
                  "Emergency escalation"
                );

                setWorkflowDescription(
                  "The call has ended after EMMA advised the patient to call 999."
                );
              }
            );

            return;
          }

          /*
           * -------------------------------------------------
           * DETERMINE WHETHER CALL SHOULD END
           * -------------------------------------------------
           */

          const backendEnd =
            data.call_ended === true ||
            data.end_call === true ||
            data.intent ===
              "call_end" ||
            data.next_action ===
              "call_end" ||
            data.next_action ===
              "end_call";

          const responseIsTerminal =
            /have a good day|goodbye|call has ended|call ended|thank you for calling/i.test(
              assistantResponse
            );

          const shouldEnd =
            backendEnd ||
            responseIsTerminal;

          /*
           * -------------------------------------------------
           * TERMINAL RESPONSE
           * -------------------------------------------------
           */

          if (shouldEnd) {
            shouldListenRef.current =
              false;

            endingCallRef.current =
              true;

            setCallState("speaking");

            callStateRef.current =
              "speaking";

            setWorkflowTitle(
              "EMMA is saying goodbye"
            );

            setWorkflowDescription(
              "EMMA has completed the conversation and is saying goodbye."
            );

            setNextAction(
              "Call ended"
            );

            speakText(
              assistantResponse,
              () => {
                endCall();
              }
            );

            return;
          }

          /*
           * -------------------------------------------------
           * NORMAL CONVERSATION
           * -------------------------------------------------
           */

          shouldListenRef.current =
            true;

          setWorkflowTitle(
            "EMMA is responding"
          );

          setWorkflowDescription(
            "EMMA is preparing a response for the patient."
          );

          speakText(
            assistantResponse
          );
        } catch (error) {
          console.error(
            "Backend error:",
            error
          );

          const errorMessage =
            "I’m sorry, I’m having trouble connecting to the surgery system. Please try again.";

          const updatedHistory: Message[] =
            [
              ...currentHistory,
              {
                role: "user",
                content: text,
              },
              {
                role: "assistant",
                content:
                  errorMessage,
              },
            ];

          historyRef.current =
            updatedHistory;

          setHistory(
            updatedHistory
          );

          setIntent(
            "system_error"
          );

          setNextAction(
            "Retry request"
          );

          setSafetyStatus(
            "Clear"
          );

          setKnowledgeStatus(
            "Not required"
          );

          shouldListenRef.current =
            true;

          speakText(
            errorMessage
          );
        } finally {
          isProcessingRef.current =
            false;
        }
      };

      /*
       * -------------------------------------------------
       * RECOGNITION ERROR
       * -------------------------------------------------
       */

      recognition.onerror = (
        event: any
      ) => {
        /*
         * Ignore stale error.
         */
        if (
          sessionId !==
          recognitionSessionRef.current
        ) {
          return;
        }

        startingRecognitionRef.current =
          false;

        const error =
          event?.error ||
          "unknown";

        console.warn(
          `Speech recognition error [Session ${sessionId}]:`,
          error
        );

        clearListeningWatchdog();

        /*
         * no-speech:
         *
         * Chrome didn't hear speech and ended
         * the recognition session.
         *
         * This is normal and should simply
         * restart listening.
         */
        if (
          error === "no-speech"
        ) {
          recognitionSessionRef.current +=
            1;

          recognitionRef.current =
            null;

          setWorkflowTitle(
            "Waiting for patient"
          );

          setWorkflowDescription(
            "EMMA didn't hear anything. Listening again."
          );

          try {
            recognition.abort();
          } catch {}

          scheduleListeningRestart(
            300
          );

          return;
        }

        /*
         * aborted:
         *
         * Usually caused intentionally by us
         * when changing recognition sessions.
         */
        if (
          error === "aborted"
        ) {
          return;
        }

        /*
         * Other errors.
         */
        recognitionSessionRef.current +=
          1;

        recognitionRef.current =
          null;

        setWorkflowTitle(
          "Speech recognition issue"
        );

        setWorkflowDescription(
          `Recognition error: ${error}. Restarting listener.`
        );

        try {
          recognition.abort();
        } catch {}

        scheduleListeningRestart(
          800
        );
      };

      /*
       * -------------------------------------------------
       * RECOGNITION END
       * -------------------------------------------------
       *
       * Chrome may end recognition without giving
       * us a useful result.
       *
       * If the call is still active, restart it.
       */

      recognition.onend = () => {
        /*
         * Ignore events from old sessions.
         */
        if (
          sessionId !==
          recognitionSessionRef.current
        ) {
          return;
        }

        startingRecognitionRef.current =
          false;

        recognitionRef.current =
          null;

        clearListeningWatchdog();

        /*
         * Don't restart if:
         *
         * - call ended
         * - EMMA is speaking
         * - backend is processing
         * - listening disabled
         */
        if (
          callStateRef.current ===
            "ended" ||
          isSpeakingRef.current ||
          isProcessingRef.current ||
          !shouldListenRef.current
        ) {
          return;
        }

        console.warn(
          `Speech recognition ended unexpectedly [Session ${sessionId}].`
        );

        setWorkflowTitle(
          "Reconnecting microphone"
        );

        setWorkflowDescription(
          "EMMA is restarting speech recognition..."
        );

        scheduleListeningRestart(
          300
        );
      };

      /*
       * -------------------------------------------------
       * START RECOGNITION
       * -------------------------------------------------
       */

      try {
        recognition.start();

        console.log(
          `Speech recognition start() called. Session ${sessionId}`
        );
      } catch (error) {
        console.error(
          `Could not start speech recognition [Session ${sessionId}]:`,
          error
        );

        if (
          sessionId ===
          recognitionSessionRef.current
        ) {
          recognitionSessionRef.current +=
            1;

          recognitionRef.current =
            null;

          startingRecognitionRef.current =
            false;

          scheduleListeningRestart(
            1000
          );
        }
      }
    }, [
      clearListeningWatchdog,
      clearRecognitionRestartTimer,
      endCall,
      scheduleListeningRestart,
      speakText,
    ]);

  /*
   * -------------------------------------------------
   * IMPORTANT:
   * UPDATE THE START-LISTENING REF AFTER THE
   * FUNCTION HAS BEEN DECLARED.
   *
   * This fixes the TypeScript error you saw.
   * -------------------------------------------------
   */

  useEffect(() => {
    startListeningRef.current =
      startListening;
  }, [startListening]);

  /*
   * -------------------------------------------------
   * START NEW CALL
   * -------------------------------------------------
   */

  const startNewCall =
    useCallback(() => {
      /*
       * Stop previous speech.
       */
      if (
        "speechSynthesis" in window
      ) {
        window.speechSynthesis.cancel();
      }

      /*
       * Stop previous recognition.
       */
      stopRecognition();

      /*
       * Reset voice state.
       */
      isProcessingRef.current =
        false;

      isSpeakingRef.current =
        false;

      startingRecognitionRef.current =
        false;

      endingCallRef.current =
        false;

      /*
       * Reset conversation.
       */
      const initialHistory: Message[] =
        [
          {
            role: "assistant",
            content: GREETING,
          },
        ];

      historyRef.current =
        initialHistory;

      setHistory(
        initialHistory
      );

      /*
       * New call state.
       */
      setCallState("speaking");

      callStateRef.current =
        "speaking";

      setCallStartedAt(
        Date.now()
      );

      setCallDuration(
        "00:00"
      );

      setIntent(
        "Waiting for patient"
      );

      setNextAction(
        "Waiting for patient"
      );

      setSafetyStatus("Ready");

      setKnowledgeStatus(
        "Not required"
      );

      setWorkflowTitle(
        "EMMA is greeting the patient"
      );

      setWorkflowDescription(
        "EMMA is introducing herself and asking how she can help."
      );

      /*
       * EMMA should listen after greeting.
       */
      shouldListenRef.current =
        true;

      /*
       * EMMA speaks first.
       */
      speakText(
        GREETING
      );
    }, [
      speakText,
      stopRecognition,
    ]);

  /*
   * -------------------------------------------------
   * CLEANUP WHEN PAGE UNMOUNTS
   * -------------------------------------------------
   */

  useEffect(() => {
    return () => {
      shouldListenRef.current =
        false;

      endingCallRef.current =
        false;

      recognitionSessionRef.current +=
        1;

      clearListeningWatchdog();

      clearRecognitionRestartTimer();

      try {
        recognitionRef.current?.abort();
      } catch {}

      recognitionRef.current =
        null;

      if (
        "speechSynthesis" in window
      ) {
        window.speechSynthesis.cancel();
      }
    };
  }, [
    clearListeningWatchdog,
    clearRecognitionRestartTimer,
  ]);

  /*
   * -------------------------------------------------
   * ACTIVE CALL
   * -------------------------------------------------
   */

  const isActive =
    callState !== "idle" &&
    callState !== "ended";

  /*
   * -------------------------------------------------
   * TURN COUNT
   * -------------------------------------------------
   */

  const turnCount =
    history.filter(
      (message) =>
        message.role === "user"
    ).length;

  /*
   * -------------------------------------------------
   * RENDER
   * -------------------------------------------------
   */

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-lg font-semibold text-white">
              E
            </div>

            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                EMMA
              </h1>

              <p className="text-xs text-slate-500">
                AI Receptionist
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {isActive && (
              <div className="hidden text-right sm:block">
                <p className="text-xs font-medium text-slate-400">
                  CALL TIME
                </p>

                <p className="text-sm font-semibold text-slate-700">
                  {callDuration}
                </p>
              </div>
            )}

            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
              <span
                className={`h-2 w-2 rounded-full ${
                  callState === "ended"
                    ? "bg-slate-400"
                    : "bg-emerald-500"
                }`}
              />

              <span className="text-xs font-medium text-slate-600">
                {callState === "ended"
                  ? "Call ended"
                  : "Surgery system online"}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <section className="mx-auto max-w-7xl px-6 pb-36 pt-10">
        {/* Intro */}
        <div className="mb-8">
          <p className="mb-2 text-sm font-medium text-slate-500">
            Primary care voice assistant
          </p>

          <h2 className="text-3xl font-semibold tracking-tight">
            How can I help you today?
          </h2>

          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            EMMA can help with appointments,
            prescriptions, practice information
            and routing.
          </p>
        </div>

        {/* Main grid */}
        <div className="grid gap-6 lg:grid-cols-[1.45fr_1fr]">
          {/* Conversation */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h3 className="font-semibold">
                  Conversation
                </h3>

                <p className="text-xs text-slate-500">
                  Live patient interaction
                </p>
              </div>

              <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
                {turnCount}{" "}
                {turnCount === 1
                  ? "exchange"
                  : "exchanges"}
              </div>
            </div>

            <div className="h-[calc(100vh-300px)] min-h-[480px] max-h-[720px] overflow-y-auto px-6 py-6">
              <div className="space-y-5">
                {history.map(
                  (
                    message,
                    index
                  ) => (
                    <div
                      key={index}
                    >
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                        {message.role ===
                        "user"
                          ? "Patient"
                          : "EMMA"}
                      </p>

                      <div
                        className={`rounded-2xl p-4 text-sm leading-6 ${
                          message.role ===
                          "user"
                            ? "rounded-tl-sm bg-slate-100 text-slate-900"
                            : "rounded-tr-sm bg-slate-900 text-white"
                        }`}
                      >
                        {message.role ===
                        "user"
                          ? `“${message.content}”`
                          : message.content}
                      </div>
                    </div>
                  )
                )}

                {/* Listening */}
                {callState ===
                  "listening" && (
                  <div>
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                      Patient
                    </p>

                    <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm bg-slate-100 p-4 text-sm text-slate-500">
                      <span className="flex gap-1">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />

                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:150ms]" />

                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:300ms]" />
                      </span>

                      Listening...
                    </div>
                  </div>
                )}

                {/* Processing */}
                {callState ===
                  "processing" && (
                  <div>
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                      EMMA
                    </p>

                    <div className="rounded-2xl rounded-tr-sm bg-slate-900 p-4 text-sm text-slate-300">
                      Thinking about the request...
                    </div>
                  </div>
                )}

                {/* Goodbye */}
                {callState ===
                  "speaking" &&
                  endingCallRef.current && (
                    <div>
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                        EMMA
                      </p>

                      <div className="rounded-2xl rounded-tr-sm bg-slate-900 p-4 text-sm text-slate-300">
                        Saying goodbye...
                      </div>
                    </div>
                  )}

                <div
                  ref={
                    conversationEndRef
                  }
                />
              </div>
            </div>
          </div>

          {/* AI Activity */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-6 py-4">
              <h3 className="font-semibold">
                AI activity
              </h3>

              <p className="text-xs text-slate-500">
                Live operational state
              </p>
            </div>

            <div className="space-y-4 p-6">
              <Activity
                label="Speech recognition"
                value={
                  callState ===
                  "listening"
                    ? "Listening..."
                    : callState ===
                        "speaking"
                      ? endingCallRef.current
                        ? "Paused — call ending"
                        : "Paused while EMMA speaks"
                      : callState ===
                          "processing"
                        ? "Paused during processing"
                        : callState ===
                            "ended"
                          ? "Ended"
                          : "Ready"
                }
                status={
                  callState ===
                  "listening"
                    ? "active"
                    : callState ===
                        "ended"
                      ? "neutral"
                      : "success"
                }
              />

              <Activity
                label="Intent"
                value={intent}
                status={
                  intent ===
                    "Waiting for patient" ||
                  callState === "ended"
                    ? "neutral"
                    : "active"
                }
              />

              <Activity
                label="Knowledge retrieval"
                value={
                  knowledgeStatus
                }
                status={
                  knowledgeStatus ===
                  "Not required"
                    ? "neutral"
                    : "success"
                }
              />

              <Activity
                label="Safety check"
                value={
                  safetyStatus
                }
                status={
                  safetyStatus ===
                    "Clear" ||
                  safetyStatus ===
                    "Ready"
                    ? "success"
                    : "active"
                }
              />

              <Activity
                label="Next action"
                value={
                  nextAction
                }
                status={
                  callState ===
                  "ended"
                    ? "neutral"
                    : "active"
                }
              />
            </div>

            {/* Current workflow */}
            <div className="border-t border-slate-200 p-6">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">
                Current workflow
              </p>

              <div className="rounded-xl bg-slate-50 p-4">
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                      callState ===
                      "ended"
                        ? "bg-slate-400"
                        : callState ===
                          "listening"
                          ? "bg-emerald-500"
                          : "bg-blue-500"
                    }`}
                  />

                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      {workflowTitle}
                    </p>

                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      {
                        workflowDescription
                      }
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Call summary */}
            {callState ===
              "ended" && (
              <div className="border-t border-slate-200 p-6">
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">
                  Call summary
                </p>

                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-slate-400">
                        Duration
                      </p>

                      <p className="mt-1 text-sm font-semibold text-slate-700">
                        {
                          callDuration
                        }
                      </p>
                    </div>

                    <div>
                      <p className="text-xs text-slate-400">
                        Exchanges
                      </p>

                      <p className="mt-1 text-sm font-semibold text-slate-700">
                        {turnCount}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Fixed voice control */}
      <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-7xl">
        <div className="rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-xl backdrop-blur">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800">
                {callState ===
                  "idle" &&
                  "Ready to talk to EMMA"}

                {callState ===
                  "speaking" &&
                  (endingCallRef.current
                    ? "EMMA is saying goodbye"
                    : "EMMA is speaking")}

                {callState ===
                  "listening" &&
                  "EMMA is listening"}

                {callState ===
                  "processing" &&
                  "EMMA is processing"}

                {callState ===
                  "ended" &&
                  "Call ended"}
              </p>

              <p className="mt-1 text-xs text-slate-500">
                {callState ===
                  "idle" &&
                  "Click start to begin. EMMA will greet you first."}

                {callState ===
                  "speaking" &&
                  (endingCallRef.current
                    ? "Please wait while EMMA finishes the call."
                    : "Please wait while EMMA finishes speaking.")}

                {callState ===
                  "listening" &&
                  "Speak naturally. EMMA is listening."}

                {callState ===
                  "processing" &&
                  "EMMA is understanding your request."}

                {callState ===
                  "ended" &&
                  "The conversation is complete. Start a new call when ready."}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-3">
              {/* End call */}
              {isActive && (
                <button
                  onClick={
                    endCall
                  }
                  className="hidden rounded-full border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 sm:block"
                >
                  End call
                </button>
              )}

              {/* Start */}
              {callState ===
                "idle" && (
                <button
                  onClick={
                    startNewCall
                  }
                  aria-label="Start call"
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg shadow-slate-300 transition hover:scale-105"
                >
                  <span className="text-2xl">
                    ●
                  </span>
                </button>
              )}

              {/* Speaking */}
              {callState ===
                "speaking" && (
                <button
                  onClick={
                    endCall
                  }
                  aria-label="End call"
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg shadow-slate-300 transition hover:scale-105"
                >
                  <span className="text-xl">
                    ■
                  </span>
                </button>
              )}

              {/* Listening */}
              {callState ===
                "listening" && (
                <button
                  onClick={
                    endCall
                  }
                  aria-label="End call"
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-white shadow-lg shadow-red-200 transition hover:scale-105"
                >
                  <span className="text-xl">
                    ■
                  </span>
                </button>
              )}

              {/* Processing */}
              {callState ===
                "processing" && (
                <button
                  onClick={
                    endCall
                  }
                  aria-label="End call"
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg shadow-slate-300 transition hover:scale-105"
                >
                  <span className="text-xl">
                    ■
                  </span>
                </button>
              )}

              {/* Ended */}
              {callState ===
                "ended" && (
                <button
                  onClick={
                    startNewCall
                  }
                  className="rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-300 transition hover:bg-slate-800"
                >
                  Start new call
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

/*
 * -------------------------------------------------
 * ACTIVITY COMPONENT
 * -------------------------------------------------
 */

function Activity({
  label,
  value,
  status,
}: {
  label: string;
  value: string;
  status:
    | "success"
    | "neutral"
    | "active";
}) {
  const dot =
    status === "success"
      ? "bg-emerald-500"
      : status === "active"
        ? "bg-blue-500"
        : "bg-slate-300";

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 p-4">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`}
        />

        <span className="text-sm font-medium text-slate-700">
          {label}
        </span>
      </div>

      <span className="max-w-[55%] truncate text-right text-xs text-slate-500">
        {value}
      </span>
    </div>
  );
}