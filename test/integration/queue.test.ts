import Queue from '../../src/queue'
import { expect } from 'chai'
import QueueManager from '../../src/queue-manager'
import { type Json } from '../../src/types'
// import { sleep } from '../../src/utils'
import { randomUUID } from 'crypto'

const QUEUE_NAME = `queue-test-default-${randomUUID()}`

describe('Queue', function () {
  const queueManager = new QueueManager()
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

  describe('constructor', () => {
    it('Queue URL configured', () => {
      const queue = new Queue('test-url')
      expect(queue.url).equal('test-url')
    })
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

  describe('enqueue & dequeue', () => {
    let QUEUE_URL: string, queue: Queue

    before(async () => {
      QUEUE_URL = await queueManager.create(`queue-test-bulk-enqueue-${randomUUID()}`) ?? ''
      queue = new Queue(QUEUE_URL)
    })

    after(async () => {
      const response = await queueManager.delete(QUEUE_URL)
      expect(response.$metadata.httpStatusCode).to.equal(200)
    })

    it('Should enqueue and dequeue a message from queue', async () => {
      const message = 'enqueue & dequeue message'
      await queue.enqueue(message)
      const result = await queue.dequeue({ MaxNumberOfMessages: 10 })
      // let result: DequeueReturnType; let retries = 10
      // do {
      //   retries--
      //   await sleep(1000)
      //   result = await queue.dequeue({ MaxNumberOfMessages: 10 })
      //   console.warn(`Retries left ${retries}`)
      // } while (result.messageObjects === undefined && retries > 0)
      expect(result.messageObjects?.indexOf(message)).to.be.above(-1)
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
})
