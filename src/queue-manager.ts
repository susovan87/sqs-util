import { SQSClient, ListQueuesCommand, CreateQueueCommand, GetQueueUrlCommand, DeleteQueueCommand, type DeleteQueueCommandOutput } from '@aws-sdk/client-sqs'
import { REGION } from './utils'
import { type CreateQueueOptions } from './types'

export default class QueueManager {
  readonly sqsClient

  constructor (sqsClient: SQSClient = new SQSClient({ region: REGION })) {
    this.sqsClient = sqsClient
  }

  async list (): Promise<string[] | undefined> {
    const { QueueUrls } = await this.sqsClient.send(new ListQueuesCommand({}))
    return QueueUrls
  }

  async create (queueName: string, options: CreateQueueOptions = {}): Promise<string | undefined> {
    const params = Object.assign({}, options, { QueueName: queueName })
    const { QueueUrl } = await this.sqsClient.send(new CreateQueueCommand(params))
    return QueueUrl
  }

  async getUrl (queueName: string): Promise<string | undefined> {
    const { QueueUrl } = await this.sqsClient.send(new GetQueueUrlCommand({ QueueName: queueName }))
    return QueueUrl
  }

  async delete (queueUrl: string): Promise<DeleteQueueCommandOutput> {
    const data = await this.sqsClient.send(new DeleteQueueCommand({ QueueUrl: queueUrl }))
    return data
  }
}
