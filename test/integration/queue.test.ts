import Queue from '../../src/queue'
import { expect } from 'chai'
import QueueManager from '../../src/queue-manager'
import { type Json } from '../../src/types'
// import { sleep } from '../../src/utils'
import { randomUUID } from 'crypto'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import * as fs from 'node:fs'
import { EOL } from 'os'

describe('Queue', function () {
  const queueManager = new QueueManager()

  describe('constructor', () => {
    it('Queue URL configured', () => {
      const queue = new Queue('test-url')
      expect(queue.url).equal('test-url')
    })
  })

  describe('basic functionality', () => {
    const QUEUE_NAME = `queue-test-basic-${randomUUID()}`
    let queue: Queue
    let QUEUE_URL: string

    before(async () => {
    // runs once before the first test in this block
      QUEUE_URL = await queueManager.create(QUEUE_NAME) ?? ''
      expect(QUEUE_URL.endsWith(QUEUE_NAME)).to.equal(true)
      queue = new Queue(QUEUE_URL)
    })
    after(async () => {
    // runs once after the last test in this block
      const response = await queueManager.delete(QUEUE_URL)
      expect(response.$metadata.httpStatusCode).to.equal(200)
    })

    describe('enqueue & next', () => {
      it('Should enqueue many messages', async () => {
        const messages: Json[] = ['string', true, false, 10, 10.123, { key: 'value' }, ['string', false, 10, 10.123, { key: 'value' }]]
        for (const m of messages) {
          expect(typeof await queue.enqueue(m)).to.equal('string')
        }

        for await (const result of queue.next({ MaxNumberOfMessages: 10 })) {
          result.messageObjects?.forEach(message => {
            const index = messages.findIndex(element => JSON.stringify(element) === JSON.stringify(message))
            if (index !== -1) {
              messages.splice(index, 1)
            } else {
              console.log('Message not found', message)
            }
          })
          await result.delete()
        }

        if (messages.length > 0) {
          console.log('Left over messages after processing all', messages)
        }

        expect(messages.length).to.equal(0)
      })
    })

    describe('getAttributes', () => {
      it('Should return all the attributes of a queue', async () => {
        const result = await queue.getAttributes()
        expect(result?.QueueArn.endsWith(QUEUE_NAME)).to.equal(true)
      })
    })

    describe('count', () => {
      it('Should return message count of a queue', async () => {
        const result = await queue.count()
        expect(typeof result).to.equal('number')
      })
    })
  })

  describe('enqueue & dequeue with message-attributes', () => {
    let QUEUE_URL: string, queue: Queue
    const QUEUE_NAME = `queue-test-enqueue-n-dequeue-${randomUUID()}`

    before(async () => {
      QUEUE_URL = await queueManager.create(QUEUE_NAME) ?? ''
      queue = new Queue(QUEUE_URL)
    })

    after(async () => {
      const response = await queueManager.delete(QUEUE_URL)
      expect(response.$metadata.httpStatusCode).to.equal(200)
    })

    it('Should enqueue and dequeue a message from queue', async () => {
      const message = 'enqueue & dequeue message'
      const messageAttributes = {
        Title: {
          DataType: 'String',
          StringValue: 'The Whistler'
        },
        Author: {
          DataType: 'String',
          StringValue: 'John Grisham'
        },
        WeeksOn: {
          DataType: 'Number',
          StringValue: '6'
        }
      }
      await queue.enqueue(message, { MessageAttributes: messageAttributes })
      const result = await queue.dequeue({ MaxNumberOfMessages: 10, MessageAttributeNames: ['All'] })
      const messageIndex = result.messageObjects?.indexOf(message)
      expect(messageIndex).to.be.above(-1)
      const actualAttributes = (result?.Messages != null) ? result?.Messages[messageIndex ?? 0].MessageAttributes : undefined

      // let result: DequeueReturnType; let retries = 10
      // do {
      //   retries--
      //   await sleep(1000)
      //   result = await queue.dequeue({ MaxNumberOfMessages: 10 })
      //   console.warn(`Retries left ${retries}`)
      // } while (result.messageObjects === undefined && retries > 0)
      expect(actualAttributes).to.be.deep.equal(messageAttributes)
      await result.delete()
    })
  })

  describe('bulkEnqueue', () => {
    let QUEUE_URL: string, queue: Queue

    before(async () => {
      QUEUE_URL = await queueManager.create(`queue-test-bulk-enqueue-${randomUUID()}`) ?? ''
      queue = new Queue(QUEUE_URL)
    })

    after(async () => {
      const response = await queueManager.delete(QUEUE_URL)
      expect(response.$metadata.httpStatusCode).to.equal(200)
    })

    it('Should enqueue multiple messages together', async () => {
      const messages = [...Array(41).keys()].map(num => (num))
      const result = await queue.bulkEnqueue(messages, {}, 3)
      expect(result.successful.length).to.equal(41)
      expect(result.failed?.length).to.equal(0)

      for await (const result of queue.next({ MaxNumberOfMessages: 10 })) {
        result.messageObjects?.forEach(message => {
          const index = messages.indexOf(Number(message))
          if (index > -1) {
            messages.splice(index, 1)
          } else {
            console.warn('Message not found', message)
          }
        })
        await result.delete()
      }

      if (messages.length > 0) {
        console.warn('Left over messages after processing all', messages)
      }

      expect(messages.length).to.equal(0)
    })
  })

  describe('Import export CSV using stream', () => {
    let QUEUE_URL: string, queue: Queue
    const messages = [...Array(22).keys()].map(num => (num))
    const QUEUE_NAME = `queue-test-import-export-csv-using-stream-${randomUUID()}`
    const CSV_FILE_PATH = './dump.csv'

    before(async () => {
      QUEUE_URL = await queueManager.create(QUEUE_NAME) ?? ''
      queue = new Queue(QUEUE_URL)
    })

    after(async () => {
      const response = await queueManager.delete(QUEUE_URL)
      expect(response.$metadata.httpStatusCode).to.equal(200)
    })

    xit('writableStream', (done) => {
      const reader = new Readable({ objectMode: true })
      const writer = queue.writableStream(100, {
        MessageAttributes: {
          Sender: {
            DataType: 'String',
            StringValue: 'Writable Stream'
          },
          Batch: {
            DataType: 'Number',
            StringValue: '6'
          }
        }
      })

      pipeline(reader, writer)
        .then(res => { console.log('SQS WRITABLE STREAM COMPLETED', res) })
        .catch(err => { console.error('ERROR in pipeline', err) })
        .finally(() => { done() })

      messages.forEach(m => reader.push(m))
      reader.push(null)
    })

    xit('exportAsCSV', async () => {
      queue = new Queue(QUEUE_URL)
      await queue.exportAsCSV(CSV_FILE_PATH, false, { VisibilityTimeout: 10 })
      expect(fs.existsSync(CSV_FILE_PATH)).to.equal(true)
      const lines = fs.readFileSync(CSV_FILE_PATH).toString().split(EOL)
      expect(lines[0]).to.equal('MessageId,Body,Attributes,MessageAttributes')
      expect(lines.length).to.equal(messages.length + 2) // Considering last empty line
    })

    xit('readableStream', (done) => {
      const reader = queue.readableStream()
      const writer = new Writable({
        objectMode: true,
        highWaterMark: 100,
        write: (chunk, _, done) => {
          const index = messages.indexOf(Number(chunk.Body))
          if (index > -1) {
            messages.splice(index, 1)
          } else {
            console.warn('Message not found', chunk)
          }
          done()
        }
      })
      pipeline(reader, writer)
        .then(res => { console.log('SQS READABLE STREAM COMPLETED', res); expect(messages.length).to.equal(0) })
        .catch(err => { console.error('ERROR in pipeline', err) })
        .finally(() => { done() })
    })
  })

  // describe('exportAsCSV', () => {
  //   let QUEUE_URL: string, queue: Queue
  //   const messages = [...Array(222).keys()].map(num => (num))
  //   const QUEUE_NAME = 'queue-test-export-as-csv' // `queue-test-export-as-csv-${randomUUID()}`

  //   before(async () => {
  //     QUEUE_URL = await queueManager.create(QUEUE_NAME) ?? ''
  //     queue = new Queue(QUEUE_URL)
  //   })

  //   after(async () => {
  //     // const response = await queueManager.delete(QUEUE_URL)
  //     // expect(response.$metadata.httpStatusCode).to.equal(200)
  //   })

  //   it('Should save all the SQS messages in a CSV', async () => {
  //     const QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/263261885435/test-queue'
  //     queue = new Queue(QUEUE_URL)
  //     await queue.exportAsCSV(false)
  //     // expect(queue.url).equal('test-url')
  //   })
  // })
})
