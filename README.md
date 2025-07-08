# WebPTZ

WebPTZ enables remote operation of pan, tilt, zoom, focus, and more for video cameras using off-the-shelf parts, as a low-cost alternative to purpose-built appliances like [APC-R](https://www.middlethings.co/) or [MultiCamZilla](multicamzilla.com).

This program can be run on any PC (including Raspberry Pi), and provides [a network-based interface](#UI-Demo) that can be operated from any web browser (even mobile devices).
Gamepad support is included, and camera functions can be freely mapped to controls on one or more game controllers.

Due to the use of gimbal stabilizers and analog controls, this system is capable of very smooth and natural-looking movements, giving a it a distinct advantage over typical PTZ cameras.

[Development thread on Twitter](https://twitter.com/gramofdata/status/1838162802067808424)


## Device Compatibility

Device compatibility is mainly limited by what gear I have access to (and time). If you're willing to send me gear to test, I can try adding support.

- DJI Ronin-S gimbal stabilizers (via Bluetooth)
  - Functions:
    - Pan
    - Tilt
    - Roll
    - Zoom/Focus motor
  - Tested with:
    - DJI RSC 2
    - DJI RS 3 (PTR functions)
- Lumix Cameras with [Lumix Tether](https://av.jpn.support.panasonic.com/support/global/cs/soft/download/d_lumixtether.html) support (via Ethernet)
  - Functions:
    - Focus
    - Auto-focus
    - Zoom (via power-zoom lenses)
  - Tested with:
    -  Panasonic DC-BGH1
- LANC (via USB-to-LANC adapter)
  - Functions (dependent on camera support):
    - Focus
    - Auto-focus
    - Zoom
  - Tested with:
    - [Novgorod's DIY USB LANC adapter](https://github.com/Novgorod/LANC-USB-GUI)
    - Blackmagic Micro Cinema Camera
    - Panasonic DC-BGH1


## UI Demo

Try out [this UI demo page](https://rawcdn.githack.com/data-enabler/webptz/master/http/index.html?mock) to get a sense for how the UI and gamepad support works.
Note that this is only a demo of the UI, and won't control any devices.

## Usage

```
webptz [config-file.json]
```
Then open the UI on the default port: http://localhost:8000

If a config file is not provided, WebPTZ will try to read from `config.json` by default.
The `config.dummy.json` file in this repository can be used as a simple example config for testing.

WebPTZ will abort startup if it is unable to connect to any devices.

## Configuration

WebPTZ requires a configuration file that specifies which devices to connect to. It is a JSON file with the following fields:

| Name | Description |
| ---- | ----------- |
| `port` | The port used to access the UI. Defaults to `8000`. |
| `groups` | Array of named device groupings. Groups are what get controlled via the UI, and can have any number of devices. Devices can also be included in multiple groups simultaneously, and only devices included in a group will be connected to. |
| `devices` | Mapping of unique device ID to device configuration. Each device has a optional `capabilities` field that can be used to only enable certain functionality for each device. Values are `ptr` (pan/tilt/rotate), `zoom`, `focus`, and `autofocus`. By default, a device will enable all supported capabilities. |
| `defaultControls` | Gamepad mappings used when the UI is first opened. Rather than editing this directly, you should use the "Save as Default" button in the gamepad controls UI. |

Check out [config.example.json](config.example.json) for an example of how to configure each device type.

### Node on Lumix devices

I haven't managed to figure out how Panasonic hashes their passwords for Lumix Tether, so in order to get the `password` to use when configuring Lumix devices, you'll need to use a tool like Wireshark to record network traffic as you connect to the camera in Lumix Tether, and then grab the `value3` query parameter from the `GET /cam.cgi` request sent to the camera. Annoying, I know.

## Development

Once you have [a working Rust install](https://www.rust-lang.org/learn/get-started), you can simply use `cargo run`.
The UI is built using [HTM](https://github.com/developit/htm), and has no build steps.
