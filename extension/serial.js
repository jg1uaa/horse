const METHOD_PING = '/ping'
// const METHOD_LOG = '/log'

export const METHOD_SIGN_MESSAGE = '/sign-message'
export const METHOD_SHARED_SECRET = '/shared-secret'
export const METHOD_PUBLIC_KEY = '/public-key'

export const PUBLIC_METHODS = [METHOD_PUBLIC_KEY, METHOD_SIGN_MESSAGE, METHOD_SHARED_SECRET]

const sleep = ms => new Promise(r => setTimeout(r, ms))

let writer
let lastCommand = 0
let resolveCommand = () => { }

export function isConnected() {
  return !!writer
}

export async function callMethodOnDevice(method, params, opts) {
  if (!writer) await initDevice(opts)

  // only one command can be pending at any time
  // but each will only wait 6 seconds
  if (lastCommand > Date.now() + 6000) return
  lastCommand = Date.now()

  return new Promise(async (resolve, reject) => {
    console.log('### callMethodOnDevice', method, params, opts)
    // setTimeout(reject, 6000)
    resolveCommand = resolve

    // send actual command
    sendCommand(method, params)
  })
}

export async function initDevice({ onConnect, onDisconnect, onError, onDone }) {
  return new Promise(async resolve => {
    let port = await navigator.serial.requestPort()
    console.log('### port', port)
    let reader


    console.log('### initDevice')

    const startSerialPortReading = async () => {
      // reading responses
      console.log('### start reading')
      while (port && port.readable) {
        const textDecoder = new window.TextDecoderStream()
        port.readable.pipeTo(textDecoder.writable)
        reader = textDecoder.readable.getReader()
        const readStringUntil = readFromSerialPort(reader)

        try {
          while (true) {
            const { value, done } = await readStringUntil('\n')
            if (value) {
              let { method, data } = parseResponse(value)
              console.log('got', method, data)

              if (PUBLIC_METHODS.indexOf(method) === -1) {
                // ignore /ping, /log responses
                continue
              }

              lastCommand = 0
              console.log('### resolveCommand(data)', data)
              resolveCommand(data)
            }
            if (done) return
            onDone()
          }
        } catch (error) {
          console.warn(error)
          onError(error.message)
        }
      }
    }

    port.open({ baudRate: 9600 })
    await sleep(3000)
    startSerialPortReading()

    const textEncoder = new window.TextEncoderStream()
    textEncoder.readable.pipeTo(port.writable)
    writer = textEncoder.writable.getWriter()

    // send ping first
    await sendCommand(METHOD_PING)
    await sendCommand(METHOD_PING, [window.location.host])

    onConnect()
    resolve()


    port.addEventListener('disconnect', () => {
      console.log('disconnected from device')
      writer = null
      onDisconnect()
    })
  })
}

async function sendCommand(method, params = []) {
  const message = [method].concat(params).join(' ')
  console.log('### sendCommand:', message)
  await writer.write(message + '\n')
}

function readFromSerialPort(reader) {
  let partialChunk
  let fulliness = []

  const readStringUntil = async (separator = '\n') => {
    if (fulliness.length) return fulliness.shift().trim()
    const chunks = []
    if (partialChunk) {
      // leftovers from previous read
      chunks.push(partialChunk)
      partialChunk = undefined
    }
    while (true) {
      const { value, done } = await reader.read()
      if (value) {
        const values = value.split(separator)
        // found one or more separators
        if (values.length > 1) {
          chunks.push(values.shift()) // first element
          partialChunk = values.pop() // last element
          fulliness = values // full lines
          return { value: chunks.join('').trim(), done: false }
        }
        chunks.push(value)
      }
      if (done) return { value: chunks.join('').trim(), done: true }
    }
  }
  return readStringUntil
}

function parseResponse(value) {
  const method = value.split(' ')[0]
  const data = value.substring(method.length).trim()

  return { method, data }
}
