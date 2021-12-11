import {BasicCrawler} from './basic_crawler';
import {URL} from 'url';
import {RequestOptions, IncomingMessage} from 'http';
import request, {Request} from '../request';
import {mergeRight} from 'ramda';
import cheerio, {CheerioAPI} from 'cheerio';
import {isArray, isString, isUrl, urlToHttpOptions} from '../helper';

export interface PageOperateParameter {
  requestOptions: string | URL | RequestOptions;
  request: Request;
  response: IncomingMessage;
  $: CheerioAPI;
  chunk: Buffer;
}

export interface CheerioCrawlerOptions {
  queue: string[] | URL[] | RequestOptions[];
  headers: { [key:string]: string } | null;
  pageOperateBefore: (
    options: Pick<PageOperateParameter, 'requestOptions' | 'request'>
  ) => void;
  pageOperateResponse: (
    options: Omit<PageOperateParameter, '$' | 'chunk'>
  ) => void;
  pageOperateComplete: (options: PageOperateParameter) => void;
  activeQueue: number;
  queueEndConventions: ((value: unknown) => void) | null;
}

const mergeDefault = mergeRight({
  headers: null,
  queue: [],
  pageOperateBefore: () => {},
  pageOperateResponse: () => {},
  pageOperateComplete: () => {},
  activeQueue: 0,
  queueEndConventions: null,
} as CheerioCrawlerOptions);

export class CheerioCrawler extends BasicCrawler {
  private option: CheerioCrawlerOptions;

  constructor(option: CheerioCrawlerOptions) {
    super();
    this.option = mergeDefault(option);
  }

  private finished(): void {
    const option = this.option;
    option.activeQueue -= 1;
    if (
      option.activeQueue === 0 &&
      !option.queue.length &&
      option.queueEndConventions
    ) {
      option.queueEndConventions(true);
    }
  }

  private hasQueue() {
    return Boolean(isArray(this.option.queue) && this.option.queue.length)
  }

  private getQueueItem() {
    return this.option.queue.shift();
  }

  private hasHeaders() {
    return Boolean(this.option.headers !== null)
  }

  private getRequest(queueItem: string | URL | RequestOptions):Request {
    if(this.hasHeaders()){
      if(isString(queueItem)){
        queueItem = mergeRight(urlToHttpOptions(new URL(queueItem)), {
          headers: this.option.headers!
        });
      }else if(isUrl(queueItem)) {
        queueItem = mergeRight(urlToHttpOptions(queueItem), {
          headers: this.option.headers!
        });
      }else{
        queueItem = mergeRight(queueItem, {
          headers: this.option.headers!
        });
      }
    }

    const requestInstance = request(queueItem);
    this.option.activeQueue += 1;
    return requestInstance;
  }

  run(){
    if (this.hasQueue()) {
      /** queueItem!
      non empty judgment the length has been verified in front and the compiler has not been identified
      */
      const queueItem = this.getQueueItem();
      const option = this.option;
      const requestInstance = this.getRequest(queueItem!);
      let response: IncomingMessage, body: Buffer;

      option.pageOperateBefore({
        requestOptions: queueItem!,
        request: requestInstance,
      });

      requestInstance
        .on('response', res => {
          response = res;
          option.pageOperateResponse({
            requestOptions: queueItem!,
            request: requestInstance,
            response: response,
          });
        })
        .on('data', chunk => {
          body = Buffer.concat(
            body ? [body, chunk] : [chunk],
            body
              ? body.length + (chunk as Buffer).length
              : (chunk as Buffer).length
          );
        })
        .on('end', () => {
          option.pageOperateComplete({
            requestOptions: queueItem!,
            request: requestInstance,
            response: response,
            $: cheerio.load(body.toString()),
            chunk: body,
          });
          this.finished();
        })
        .end();
      process.nextTick(() => {
        this.run();
      });
    }

    return this;
  }

  /**
   * returns an agreement that when the queue is empty and does not have an active
   * @returns Promise
   */
  end() {
    return new Promise(resolve => {
      this.option.queueEndConventions = resolve;
    });
  }
}
