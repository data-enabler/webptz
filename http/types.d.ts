declare module 'https://unpkg.com/htm@^3.1.1/preact/standalone.module.js' {
  import { FunctionComponent } from 'react';
  export {
    render,
    useState,
    useEffect,
    useRef,
    useCallback,
  } from 'react';
  export function html(jsx: TemplateStringsArray, ...args: any[]): FunctionComponent;
}

declare module 'https://unpkg.com/reconnecting-websocket@^4.4.0/dist/reconnecting-websocket-mjs.js' {
  declare namespace ReconnectingWebSocket {
    interface Options {
      WebSocket?: any;
      maxReconnectionDelay?: number;
      minReconnectionDelay?: number;
      reconnectionDelayGrowFactor?: number;
      minUptime?: number;
      connectionTimeout?: number;
      maxRetries?: number;
      maxEnqueuedMessages?: number;
      startClosed?: boolean;
      debug?: boolean;
    }
  }
  export default class ReconnectingWebSocket extends WebSocket {
    constructor(url: string, protocols?: string | string[], options?: ReconnectingWebSocket.Options);
  }
}
