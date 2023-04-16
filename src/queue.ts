import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  type SendMessageCommandInput,
  type ReceiveMessageCommandInput,
  type SendMessageBatchRequestEntry,
  type DeleteMessageCommandOutput
} from '@aws-sdk/client-sqs'

import {
  type QueueOptions,
  type Json,
  type EnqueueOptions,
  type DequeueOptions,
  type DequeueReturnType,
  type BulkEnqueueOptions, type BulkEnqueueResult
} from './types'

import { REGION, getEntries, processConcurrentBatches } from './utils'

export default class Queue {
  readonly defaultOptions: QueueOptions
  readonly url: string
  readonly sqsClient: SQSClient

  constructor (
    url: string,
    options: QueueOptions = {},
    sqsClient: SQSClient = new SQSClient({ region: REGION })
  ) {
    this.url = url
    this.defaultOptions = options
    this.sqsClient = sqsClient
  }

  async enqueue (obj: Json, options: EnqueueOptions = {}): Promise<string | undefined> {
    const params: SendMessageCommandInput = Object.assign({},
      this.defaultOptions,
      options,
      { MessageBody: JSON.stringify(obj), QueueUrl: this.url }
    )

    const { MessageId } = await this.sqsClient.send(new SendMessageCommand(params))
    return MessageId
  }

  async bulkEnqueue (objs: Json[], options: BulkEnqueueOptions = {}, concurrency = 10): Promise<BulkEnqueueResult> {
    const params: BulkEnqueueOptions = Object.assign({}, this.defaultOptions, options)
    const result: BulkEnqueueResult = { successful: [], failed: [] }
    let batches: SendMessageBatchRequestEntry[][] = []

    for (const entries of getEntries(objs, params)) {
      batches.push(entries)

      if (batches.length >= concurrency) {
        const { successful, failed } = await processConcurrentBatches(batches, this.sqsClient, this.url)
        result.successful.push(...successful)
        result.failed?.push(...(failed != null) ? failed : [])

        batches = []
      }
    }

    // Remaining items in batch
    if (batches.length > 0) {
      const { successful, failed } = await processConcurrentBatches(batches, this.sqsClient, this.url)
      result.successful.push(...successful)
      result.failed?.push(...(failed != null) ? failed : [])
    }

    return result
  }

  async dequeue (options: DequeueOptions = {}): Promise<DequeueReturnType> {
    const params: ReceiveMessageCommandInput = Object.assign({},
      this.defaultOptions,
      options,
      { QueueUrl: this.url }
    )
    const { Messages } = await this.sqsClient.send(new ReceiveMessageCommand(params))
    const messageObjects = Messages?.map(({ Body }) => (Body != null) ? JSON.parse(Body) : Body)

    return {
      Messages,
      messageObjects,
      delete: async () => {
        if (Messages != null) {
          void Promise.allSettled(
            Messages.map(
              async ({ ReceiptHandle }) => await this.delete(ReceiptHandle)
            )
          )
        }
      }
    }
  }

  // returns an async iterator; https://www.nodejsdesignpatterns.com/blog/javascript-async-iterators/
  async * next (options: DequeueOptions = {}): AsyncGenerator<DequeueReturnType> {
    let result

    do {
      result = await this.dequeue(options)
      yield result
    } while (((result?.messageObjects) != null) && result?.messageObjects.length > 0)
  }

  async delete (receiptHandle: string | undefined): Promise<DeleteMessageCommandOutput> {
    const params = { QueueUrl: this.url, ReceiptHandle: receiptHandle }
    return await this.sqsClient.send(new DeleteMessageCommand(params))
  }

  async getAttributes (): Promise<Record<string, string> | undefined> {
    const params = {
      QueueUrl: this.url,
      AttributeNames: ['All']
    }
    const { Attributes } = await this.sqsClient.send(new GetQueueAttributesCommand(params))
    return Attributes
  }

  async count (): Promise<number | undefined> {
    const attributes = await this.getAttributes()
    if ((attributes?.ApproximateNumberOfMessages) != null) {
      return Number(attributes.ApproximateNumberOfMessages)
    }
    return undefined
  }
}
