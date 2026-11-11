import * as WebBrowser from 'expo-web-browser';
import { NativeModules, Platform } from 'react-native';
import { AuthError, CALLBACK_PATH, type LoopbackBrowser } from '@/assistant/chatgptAuth';

const RETURN_URL = 'pfmobile://signed-in';
const TIMEOUT_MS = 10 * 60_000;

const PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Signed in</title><body style="font-family: system-ui; text-align: center; padding: 48px 24px">
<h2>Signed in</h2><p>You can return to the app.</p><p><a href="${RETURN_URL}">Return to the app</a></p>
<script>location.replace(${JSON.stringify(RETURN_URL)})</script></body>`;

/**
 * OpenAI only redirects sign-ins to http://127.0.0.1:<port>/auth/callback, so for the
 * length of one sign-in the app listens on a loopback port of its own. That needs a TCP
 * socket, which Expo Go and browsers do not have: there, sign-in reports unavailable.
 */
export const loopbackBrowser: LoopbackBrowser = {
  available: () => Platform.OS !== 'web' && !!NativeModules.TcpSockets,

  authorize(authorizeUrl) {
    // Loaded only when used, so the app starts where the native module is missing.
    const TcpSocket = require('react-native-tcp-socket');
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      let port = 0;
      const finish = (work: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        server.close();
        if (Platform.OS === 'ios') WebBrowser.dismissAuthSession();
        work();
      };
      const timer = setTimeout(() => finish(() => reject(new AuthError('cancelled', 'Sign-in timed out.'))), TIMEOUT_MS);

      const server = TcpSocket.createServer((socket: any) => {
        let request = '';
        socket.on('data', (chunk: unknown) => {
          request += String(chunk);
          if (!request.includes('\r\n\r\n')) return;
          const path = request.split(' ')[1] ?? '';
          const found = path.startsWith(CALLBACK_PATH);
          const body = found ? PAGE : '';
          socket.write(
            `HTTP/1.1 ${found ? '200 OK' : '404 Not Found'}\r\nContent-Type: text/html; charset=utf-8\r\n` +
              `Content-Length: ${body.length}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n${body}`,
            'utf8',
            () => socket.destroy(),
          );
          if (found) finish(() => resolve(`http://127.0.0.1:${port}${path}`));
        });
        socket.on('error', () => socket.destroy());
      });
      server.on('error', () => finish(() => reject(new AuthError('unavailable', 'Could not start the sign-in listener.'))));
      // Port 0 asks the system for any free port; only this device can reach 127.0.0.1.
      server.listen({ port: 0, host: '127.0.0.1' }, () => {
        port = server.address().port;
        WebBrowser.openAuthSessionAsync(authorizeUrl(`http://127.0.0.1:${port}${CALLBACK_PATH}`), RETURN_URL)
          .then((result) => {
            // Closing the browser without finishing; give a just-arrived callback a moment.
            if (result.type !== 'success') {
              setTimeout(() => finish(() => reject(new AuthError('cancelled', 'Sign-in was cancelled.'))), 500);
            }
          })
          .catch(() => finish(() => reject(new AuthError('unavailable', 'Could not open the ChatGPT sign-in page.'))));
      });
    });
  },
};
