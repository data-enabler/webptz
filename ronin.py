from crc import Calculator, Configuration
import simplepyble

service_uuid = "0000fff0-0000-1000-8000-00805f9b34fb"
characteristic_uuid = "0000fff5-0000-1000-8000-00805f9b34fb"

crc_algo = Configuration(
    width=16,
    polynomial=0x1021,
    init_value=0x496c,
    final_xor_value=0x0000,
    reverse_input=True,
    reverse_output=True,
)
crc_calc = Calculator(crc_algo, optimized=True)

def add_checksum(b: bytes):
    checksum = crc_calc.checksum(b)
    return b + checksum.to_bytes(2, byteorder='little')

def create_packet(seq_num: int, pan: int, tilt: int, roll: int) -> bytes:
    prefix = bytes.fromhex('551604fc0204')
    midfix = bytes.fromhex('400401')
    suffix = bytes.fromhex('000002')

    seq_bytes = seq_num.to_bytes(2, byteorder='little')
    pan_bytes = (pan + 1024).to_bytes(2, byteorder='little')
    tilt_bytes = (tilt + 1024).to_bytes(2, byteorder='little')
    roll_bytes = (roll + 1024).to_bytes(2, byteorder='little')

    return add_checksum(prefix + seq_bytes + midfix + tilt_bytes + roll_bytes + pan_bytes + suffix)

def scale_value(val: float) -> float:
    # Scale value to [-1024, 1024] and make it easier to hit smaller values
    return int(val * abs(val) * 256)

class Ronin:
    def __init__(self, peripheral):
        self.seq = 0
        self.peripheral = peripheral
        print(f"Connecting to: {self.peripheral.identifier()} [{self.peripheral.address()}]")
        self.peripheral.connect()

    def disconnect(self):
        print(f"Disconnecting from: {self.peripheral.identifier()} [{self.peripheral.address()}]")
        self.peripheral.disconnect()

    def send_command(self, pan: float, tilt: float, roll: float):
        pan_int = scale_value(pan)
        tilt_int = scale_value(tilt)
        roll_int = scale_value(roll)
        content = create_packet(self.seq, pan_int, tilt_int, roll_int)
        print("Sending " + content.hex() + "\n")
        self.peripheral.write_request(service_uuid, characteristic_uuid, content)
        self.seq = (self.seq + 1) % 65536
