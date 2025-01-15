declare module 'htm/preact' {
  import { ReactNode } from 'react';
  export {
    render,
    useState,
    useEffect,
    useRef,
    useCallback,
  } from 'react';
  export function html(jsx: TemplateStringsArray, ...args: any[]): ReactNode;
}

declare module 'reconnecting-websocket' {
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
