import { SQSClient } from '@aws-sdk/client-sqs'
import QueueManager from '../../src/queue-manager'
import { expect } from 'chai'
import { randomUUID } from 'crypto'

const QUEUE_NAME = `queue-manager-test-${randomUUID()}`

describe('QueueManager', () => {
  const queueManager = new QueueManager()
  let QUEUE_URL: string

  before(async () => {
    // runs once before the first test in this block
    QUEUE_URL = await queueManager.create(QUEUE_NAME) ?? ''
    expect(QUEUE_URL.endsWith(QUEUE_NAME)).to.equal(true)
  })
  after(async () => {
    // runs once after the last test in this block
    const response = await queueManager.delete(QUEUE_URL)
    expect(response.$metadata.httpStatusCode).to.equal(200)
  })

  describe('list', () => {
    it('Should return a list of queues', async () => {
      const queues = await queueManager.list()
      expect(Array.isArray(queues)).to.equal(true)
      expect(queues?.indexOf(QUEUE_URL)).to.not.equal(-1)
    })

    it('The queue should not exists on a different region', async () => {
      const queueManager = new QueueManager(new SQSClient({ region: 'us-east-2' }))
      const queues = await queueManager.list()
      expect(queues?.indexOf(QUEUE_URL)).to.equal(-1)
    })
  })

  describe('getUrl', () => {
    it('Should return URL of the queue', async () => {
      const url = await queueManager.getUrl(QUEUE_NAME)
      expect(url).to.equal(QUEUE_URL)
    })
  })
})
