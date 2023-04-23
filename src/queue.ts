import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  type SendMessageCommandInput,
  type ReceiveMessageCommandInput,
  type SendMessageBatchRequestEntry,
  type DeleteMessageCommandOutput,
  SendMessageBatchCommand,
  PurgeQueueCommand
} from '@aws-sdk/client-sqs'

import {
  type QueueOptions,
  type Json,
  type EnqueueOptions,
  type DequeueOptions,
  type DequeueReturnType,
  type BulkEnqueueOptions, type BulkEnqueueResult, type MessageInStream
} from './types'

import { transform, stringify } from 'csv'
import { pipeline } from 'node:stream/promises'
import { Readable, Writable } from 'node:stream'
import { createWriteStream } from 'fs'

import { REGION, getEntries, getEntriesIterator, processConcurrentBatches } from './utils'

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

    for (const entries of getEntriesIterator(objs, params)) {
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

  async dequeue (options: DequeueOptions = {}, parseMessage = true): Promise<DequeueReturnType> {
    const params: ReceiveMessageCommandInput = Object.assign({},
      this.defaultOptions,
      options,
      { QueueUrl: this.url }
    )
    const { Messages } = await this.sqsClient.send(new ReceiveMessageCommand(params))
    const messageObjects = parseMessage && (Messages != null) ? Messages.map(({ Body }) => (Body != null) ? JSON.parse(Body) : Body) : undefined

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

  // Returns a readable stream of SQS message; accepts no of messages to keep in buffer as argument
  // It do not delete any messages from SQS; to delete messages after processing call `deleteAll()`
  readableStream (buffer: number = 100, dequeueOptions: DequeueOptions = {}): Readable {
    const params = Object.assign({}, { MaxNumberOfMessages: 10 }, dequeueOptions)
    const reader = new Readable({
      objectMode: true,
      highWaterMark: buffer,
      read: () => {
        this.dequeue(params).then(resp => {
          if (resp.Messages != null && resp.Messages.length > 0) {
            resp.Messages.forEach(message => reader.push(message))
          } else {
            reader.push(null)
          }
        }).catch(err => { reader.destroy(err) })
      }
    })

    return reader
  }

  // return a writable stream of SQS messages; accepts no of messages to keep in buffer as argument
  writableStream (buffer: number = 100, enqueueOptions: EnqueueOptions = {}): Writable {
    let cache: MessageInStream[] = []

    const writer = new Writable({
      objectMode: true,
      highWaterMark: buffer,
      write: (chunk, _, done) => {
        cache.push(chunk)
        if (cache.length >= 10) {
          this.sqsClient.send(new SendMessageBatchCommand({ QueueUrl: this.url, Entries: getEntries(cache, enqueueOptions) }))
            .then(res => { cache = []; done() }).catch(err => writer.destroy(err))
        } else {
          done()
        }
      },
      final: (done) => {
        if (cache.length > 0) {
          this.sqsClient.send(new SendMessageBatchCommand({ QueueUrl: this.url, Entries: getEntries(cache, enqueueOptions) }))
            .then(res => { done() }).catch(err => writer.destroy(err))
        }
        done()
      }
    })
    return writer
  }

  // returns an async iterator; https://www.nodejsdesignpatterns.com/blog/javascript-async-iterators/
  async * next (options: DequeueOptions = {}): AsyncGenerator<DequeueReturnType> {
    const params = Object.assign({}, { MaxNumberOfMessages: 10 }, options)
    let result

    do {
      result = await this.dequeue(params)
      yield result
    } while (((result?.messageObjects) != null) && result?.messageObjects.length > 0)
  }

  async delete (receiptHandle: string | undefined): Promise<DeleteMessageCommandOutput> {
    const params = { QueueUrl: this.url, ReceiptHandle: receiptHandle }
    return await this.sqsClient.send(new DeleteMessageCommand(params))
  }

  async deleteAll (): Promise<void> {
    await this.sqsClient.send(new PurgeQueueCommand({ QueueUrl: this.url }))
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

  async exportAsCSV (filePath: string, deleteMessagesAfterExport: boolean = false, dequeueOptions: DequeueOptions = {}): Promise<void> {
    const params = Object.assign({}, {
      MaxNumberOfMessages: 10,
      MessageAttributeNames: ['All'],
      AttributeNames: ['All'],
      VisibilityTimeout: 30
    }, dequeueOptions)
    const sqsReader = this.readableStream(100, params)
    const transformer = transform(({ MessageId, Body, Attributes, MessageAttributes }) => {
      return { MessageId, Body, Attributes, MessageAttributes }
    })
    const stringifier = stringify({ header: true })
    const csvFileStream = createWriteStream(filePath)
    csvFileStream.on('error', (error) => {
      console.error(`An error occured while writing to the file '${filePath}'. Error: ${error.message}`)
    })

    await pipeline(sqsReader, transformer, stringifier, csvFileStream)

    if (deleteMessagesAfterExport) {
      await this.deleteAll()
    }
  }

  // importFromCSV (filePath: string): void {
  //   const sqsWriter = this.writableStream(100, params)
  //   const transformer = transform(({ MessageId, Body, Attributes, MessageAttributes }) => {
  //     return { MessageId, Body, Attributes, MessageAttributes }
  //   })
  //   const stringifier = stringify({ header: true })
  //   const csvFileStream = createWriteStream(filePath)
  //   csvFileStream.on('error', (error) => {
  //     console.error(`An error occured while writing to the file '${filePath}'. Error: ${error.message}`)
  //   })

  //   await pipeline(sqsReader, transformer, stringifier, csvFileStream)
  // }

  // async exportToS3 (): Promise<void> {

  // }
}
