# ReliaTox

ReliaTox supports chat, file transfer, and video conferencing. If a file transfer is interrupted, the sender can reconnect and continue from the last confirmed position. The server verifies the completed file using SHA-256.

ReliaTox consists of a **Node.js server and a browser-based frontend**. The server must be running before the application can be used.

## Running the Application

ReliaTox requires Node.js 20 or later.

```bash
npm install
npm run build
npm start
```

Open [http://localhost:8787](http://localhost:8787) in a browser.

> Browsers allow camera and microphone access only on `localhost` or HTTPS pages. If you open the application through `http://LAN-IP:8787`, chat and file transfer will work, but the meeting feature will not be able to access the camera.

For development, use two terminals:

```bash
# Terminal 1: start the server
npm start

# Terminal 2: start the frontend development server
npm run dev
```

The development frontend runs at [http://localhost:5173](http://localhost:5173) and proxies `/api` and `/ws` requests to port `8787`.

## Testing with Two Accounts

You can test the application on one computer:

1. Open the application in a regular browser window and register an account named `alice`.
2. Open the application in a private window or another browser and register an account named `bob`.
3. The login session is stored in `sessionStorage`, so separate browser tabs or windows can use different accounts.
4. In the Contacts page, Alice can search for `bob` and add Bob as a friend.
5. The two accounts can then exchange messages and files or start a meeting.

## Features

| Feature | Implementation |
| --- | --- |
| Accounts | Users can register and log in with a username and password. Passwords are stored as salted scrypt hashes, and login sessions use random tokens. |
| Friends and chat | Users can add friends using a username or a 76-character ID. Messages are delivered in real time. Offline messages are stored on the server and become available when the user reconnects. |
| File transfer | The transfer begins after the recipient accepts the file. The sender transmits the file in chunks. After receiving all chunks, the server verifies the SHA-256 hash. It keeps the completed file only if the hashes match. |
| Resumable transfer | The server maintains a transfer ledger that records the confirmed byte offset of each file. After a disconnection, the sender resumes from this offset and sends only the remaining bytes. |
| Adaptive scheduling | Speed, Fairness, and Power Saving policies control the number of concurrent transfers. The client measures RTT to evaluate link quality and reduces concurrency when the connection is poor. Users can also set an upload speed limit. |
| Smart plan | Local rules analyze the current transfer state and suggest adjustments, such as which interrupted transfer to resume first or which task should receive priority. The system applies a plan only after user confirmation. This feature does not use a large language model. |
| Video conferencing | Users can create a meeting with a six-character meeting code, enter a code to join a meeting, or invite a friend. Meetings support camera, microphone, screen sharing, mute-state synchronization, and active-speaker indication. Each meeting supports up to eight participants. |
| Voice and video calls | The phone and camera buttons in the chat view create a new meeting and invite the selected friend. |

## Verifying Resumable File Transfer

The Transfer page displays resume-verification data from the server-side transfer ledger.

1. Alice sends Bob a large file, preferably several dozen megabytes or more.
2. Bob accepts the transfer.
3. On the Transfer page, set the upload speed limit to `1 MB/s` so that the transfer progress is easier to observe.
4. When approximately half of the file has been transferred, click **Disconnect Network**.
5. Record the confirmed offset as **A**.
6. Click **Reconnect** and confirm that the transfer should resume.
7. The client resumes from offset **A** and sends only the remaining bytes, recorded as **B**.
8. Verify the following condition:

```text
A + B = File Size
```

The sender's SHA-256 value must also match the SHA-256 value of the file received by the server.

## Testing

Run the automated tests with:

```bash
npm test
```

The test suite starts a temporary server and establishes real WebSocket connections. It covers:

- Account registration and login
- Friend management
- Real-time messaging
- File transfer interruption
- Transfer resumption
- Verification that `A + B = File Size`
- Rejection of files with mismatched SHA-256 hashes
- WebRTC meeting signaling

## Limitations

- ReliaTox relays file transfers through the server. It does not provide peer-to-peer file transfer and does not integrate `toxcore`. The server generates IDs during registration using the same format as Tox IDs.
- Chat messages and file contents do not use end-to-end encryption. The server can access their contents.
- Meeting media uses direct WebRTC connections between browsers. The server only relays signaling messages.
- The default configuration does not include STUN or TURN servers. Therefore, meeting connectivity is guaranteed only on the same device or local network.
- To support meetings across different networks, configure the `ICE_SERVERS` environment variable. For example:

```bash
ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"}]' npm start
```

- After the page is refreshed, the browser can no longer access the previously selected file. To resume the transfer, the user must select the same file again. ReliaTox verifies its fingerprint and rejects a different file.
- Application data is stored in `server/data/`, including accounts, messages, transfer records, and received files.

## Configuration

| Environment Variable | Default Value | Description |
| --- | --- | --- |
| `PORT` | `8787` | Port used by the server |
| `HOST` | `127.0.0.1` | Server address. Set it to `0.0.0.0` to allow other devices on the local network to connect. |
| `RELIATOX_DATA` | `server/data` | Directory used for persistent application data |
| `ICE_SERVERS` | Empty | JSON array containing WebRTC STUN or TURN server configurations |

## Project Structure

```text
server/
  index.js    HTTP endpoints for registration, login, downloads, and static files
  hub.js      WebSocket hub for presence, chat, transfer records, and meeting signaling
  store.js    Persistent storage for accounts, messages, and transfer records
  test/       End-to-end tests

src/
  net/        Client connection, transfer scheduling, WebRTC meetings, and state
  views/      User interface components
```
