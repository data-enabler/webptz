from ble import scan_for_peripherals
import json
from naja_atra import route, server, WebsocketHandler, WebsocketRequest, WebsocketSession, websocket_handler, request_map
import os
from ronin import Ronin

root = os.path.dirname(os.path.abspath(__file__))

def clamp_value(val: float) -> float:
    return max(-1, min(1, val))

if __name__ == "__main__":
    peripherals = scan_for_peripherals()
    peripherals = [p for p in peripherals if p.identifier().startswith("DJI")]

    if (len(peripherals) == 0):
        print("No Ronin gimbals found")
        exit()
    devices = [Ronin(p) for p in peripherals]

    try:
        @request_map("/")
        def redirect():
            return Redirect("/index.html")

        @websocket_handler(endpoint="/control")
        class WSHandler(WebsocketHandler):
            def on_handshake(self, request: WebsocketRequest):
                print(f"Request received: {request.path_values}")
                return 0, {}

            def on_text_message(self, session: WebsocketSession, message: str):
                print(f">>{session.id}<< Message received: {message}")
                data = json.loads(message)
                cameraNum = int(data['camera'])
                pan = clamp_value(data['pan'])
                tilt = clamp_value(data['tilt'])
                roll = clamp_value(data['roll'])
                devices[cameraNum].send_command(pan, tilt, roll);
                session.send(message)

        server.start(
            host="0.0.0.0",
            port=8000,
            resources={
                "/**": "%s/http/" % root, 
            }
        )
    except:
        for d in devices:
            d.disconnect()
        exit()


