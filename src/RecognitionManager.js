import isAndroid from './isAndroid'
import { debounce, concatTranscripts } from './utils'

export default class RecognitionManager {
  constructor(SpeechRecognition) {
    this.recognition = null
    this.pauseAfterDisconnect = false
    this.interimTranscript = ''
    this.finalTranscript = ''
    this.listening = false
    this.subscribers = {}
    this.onStopListening = () => {}
    this.previousResultWasFinalOnly = false

    this.resetTranscript = this.resetTranscript.bind(this)
    this.startListening = this.startListening.bind(this)
    this.stopListening = this.stopListening.bind(this)
    this.abortListening = this.abortListening.bind(this)
    this.setSpeechRecognition = this.setSpeechRecognition.bind(this)

    this.setSpeechRecognition(SpeechRecognition)

    if (isAndroid()) {
      this.updateFinalTranscript = debounce(
        this.updateFinalTranscript,
        250,
        true,
      )
    }

    this.negotiationPhrases = [
      'all the remaining',
      "that's it",
      'you take',
      'I want',
      'I want everything',
      'I would like to',
      'I would like',
      'I want to',
      'I need to',
      'rest is yours',
      'you can have the rest',
      'I offer',
      'I accept',
      'you give me',
      'all remaining',
      'I agree',
      'you can',
      'I can give',
      'I want',
    ]
    this.domainKeywords = [
      'one apple',
      'two apple',
      'two apples',
      'three apple',
      'three apples',
      'four apple',
      'four apples',
      'one banana',
      'two banana',
      'two bananas',
      'three banana',
      'three bananas',
      'four banana',
      'four bananas',
      'one orange',
      'two orange',
      'two oranges',
      'three orange',
      'three oranges',
      'four orange',
      'four oranges',
      'one watermelon',
      'two watermelon',
      'two watermelons',
      'three watermelon',
      'three watermelons',
      'four watermelon',
      'four watermelons',
      'all apples',
      'all oranges',
      'all bananas',
      'all watermelons',
      'all of apples',
      'all of oranges',
      'all of bananas',
      'all of watermelons',
      'all of the apples',
      'all of the oranges',
      'all of the bananas',
      'all of the watermelons',
      'zero apple',
      'zero orange',
      'zero banana',
      'zero watermelon',
      'all of them',
    ]
  }

  setSpeechRecognition(SpeechRecognition) {
    if (SpeechRecognition) {
      this.recognition = new SpeechRecognition()
      this.recognition.continuous = false
      this.recognition.interimResults = true
      this.recognition.maxAlternatives = 3
      this.recognition.onresult = this.updateTranscript.bind(this)
      this.recognition.onend = this.onRecognitionDisconnect.bind(this)
      this.emitBrowserSupportsSpeechRecognitionChange(true)
    }
  }

  boost(eventResults) {
    // Similarity bakılabilir.
    // Anagram yapısı kullanılabilir.

    // TODO: Levenshtein distance ile kontrol et.
    // TODO: Message protocol for dynamic threshold (Levenshtein).
    // TODO: Threshold 1'den basliyor.

    let maxConfidence = 0
    let maxConfidenceIndex = 0

    console.log('Interim results')
    for (let i = 0; i < eventResults.length; i++) {
      let confidence = eventResults[i].confidence
      for (let j = 0; j < this.domainKeywords.length; j++) {
        if (eventResults[i].transcript.includes(this.domainKeywords[j])) {
          // Check if any of the keywords are included in the domain keywords..
          confidence += 40
        }
      }

      for (let k = 0; k < this.negotiationPhrases.length; k++) {
        if (eventResults[i].transcript.includes(this.negotiationPhrases[k])) {
          // Check if any of the keywords are included in the domain keywords..
          confidence += 30
        }
      }

      if (confidence > maxConfidence) {
        maxConfidence = confidence
        maxConfidenceIndex = i
      }
      // console.log('Results: ' + eventResults[i].transcript);
      // console.log('Results: ' + eventResults[i].confidence);
    }

    return eventResults[maxConfidenceIndex].transcript
  }

  subscribe(id, callbacks) {
    this.subscribers[id] = callbacks
  }

  unsubscribe(id) {
    delete this.subscribers[id]
  }

  emitListeningChange(listening) {
    this.listening = listening
    Object.keys(this.subscribers).forEach((id) => {
      const { onListeningChange } = this.subscribers[id]
      onListeningChange(listening)
    })
  }

  emitTranscriptChange(interimTranscript, finalTranscript) {
    Object.keys(this.subscribers).forEach((id) => {
      const { onTranscriptChange } = this.subscribers[id]
      onTranscriptChange(interimTranscript, finalTranscript)
    })
  }

  emitClearTranscript() {
    Object.keys(this.subscribers).forEach((id) => {
      const { onClearTranscript } = this.subscribers[id]
      onClearTranscript()
    })
  }

  emitBrowserSupportsSpeechRecognitionChange(
    browserSupportsSpeechRecognitionChange,
  ) {
    Object.keys(this.subscribers).forEach((id) => {
      const {
        onBrowserSupportsSpeechRecognitionChange,
        onBrowserSupportsContinuousListeningChange,
      } = this.subscribers[id]
      onBrowserSupportsSpeechRecognitionChange(
        browserSupportsSpeechRecognitionChange,
      )
      onBrowserSupportsContinuousListeningChange(
        browserSupportsSpeechRecognitionChange,
      )
    })
  }

  disconnect(disconnectType) {
    if (this.recognition && this.listening) {
      switch (disconnectType) {
        case 'ABORT':
          this.pauseAfterDisconnect = true
          this.abort()
          break
        case 'RESET':
          this.pauseAfterDisconnect = false
          this.abort()
          break
        case 'STOP':
        default:
          this.pauseAfterDisconnect = true
          this.stop()
      }
    }
  }

  onRecognitionDisconnect() {
    this.onStopListening()
    this.listening = false
    if (this.pauseAfterDisconnect) {
      this.emitListeningChange(false)
    } else if (this.recognition) {
      if (this.recognition.continuous) {
        this.startListening({ continuous: this.recognition.continuous })
      } else {
        this.emitListeningChange(false)
      }
    }
    this.pauseAfterDisconnect = false
  }

  updateTranscript({ results, resultIndex }) {
    const currentIndex =
      resultIndex === undefined ? results.length - 1 : resultIndex
    this.interimTranscript = ''
    this.finalTranscript = ''
    for (let i = currentIndex; i < results.length; ++i) {
      if (
        results[i].isFinal &&
        (!isAndroid() || results[i][0].confidence > 0)
      ) {
        const finalTranscript = results[i][0].transcript
        finalTranscript += this.boost(results[i])

        this.updateFinalTranscript(results[i][0].transcript)
      } else {
        this.interimTranscript = concatTranscripts(
          this.interimTranscript,
          results[i][0].transcript,
        )
      }
    }
    let isDuplicateResult = false
    if (this.interimTranscript === '' && this.finalTranscript !== '') {
      if (this.previousResultWasFinalOnly) {
        isDuplicateResult = true
      }
      this.previousResultWasFinalOnly = true
    } else {
      this.previousResultWasFinalOnly = false
    }
    if (!isDuplicateResult) {
      this.emitTranscriptChange(this.interimTranscript, this.finalTranscript)
    }
  }

  updateFinalTranscript(newFinalTranscript) {
    this.finalTranscript = concatTranscripts(
      this.finalTranscript,
      newFinalTranscript,
    )
  }

  resetTranscript() {
    this.disconnect('RESET')
  }

  async startListening({ continuous = false, language } = {}) {
    if (!this.recognition) {
      return
    }

    const isContinuousChanged = continuous !== this.recognition.continuous
    const isLanguageChanged = language && language !== this.recognition.lang
    if (isContinuousChanged || isLanguageChanged) {
      if (this.listening) {
        await this.stopListening()
      }
      this.recognition.continuous = isContinuousChanged
        ? continuous
        : this.recognition.continuous
      this.recognition.lang = isLanguageChanged
        ? language
        : this.recognition.lang
    }
    if (!this.listening) {
      if (!this.recognition.continuous) {
        this.resetTranscript()
        this.emitClearTranscript()
      }
      try {
        this.start()
      } catch (DOMException) {
        // Tried to start recognition after it has already started - safe to swallow this error
      }
      this.emitListeningChange(true)
    }
  }

  async abortListening() {
    this.disconnect('ABORT')
    this.emitListeningChange(false)
    await new Promise((resolve) => {
      this.onStopListening = resolve
    })
  }

  async stopListening() {
    this.disconnect('STOP')
    this.emitListeningChange(false)
    await new Promise((resolve) => {
      this.onStopListening = resolve
    })
  }

  getRecognition() {
    return this.recognition
  }

  start() {
    if (this.recognition && !this.listening) {
      this.recognition.start()
      this.listening = true
    }
  }

  stop() {
    if (this.recognition && this.listening) {
      this.recognition.stop()
      this.listening = false
    }
  }

  abort() {
    if (this.recognition && this.listening) {
      this.recognition.abort()
      this.listening = false
    }
  }
}
