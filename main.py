from crc import Calculator, Configuration
import simplepyble

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

def create_packet(pan: int, tilt: int, roll: int) -> bytes:
    prefix = bytes.fromhex('551604fc0204')
    midfix = bytes.fromhex('400401')
    suffix = bytes.fromhex('000002')

    seq_bytes = create_packet.seq.to_bytes(2, byteorder='little')
    pan_bytes = (pan + 1024).to_bytes(2, byteorder='little')
    tilt_bytes = (tilt + 1024).to_bytes(2, byteorder='little')
    roll_bytes = (roll + 1024).to_bytes(2, byteorder='little')

    create_packet.seq = (create_packet.seq + 1) % 65536
    return add_checksum(prefix + seq_bytes + midfix + tilt_bytes + roll_bytes + pan_bytes + suffix)

create_packet.seq = 0


if __name__ == "__main__":
    adapters = simplepyble.Adapter.get_adapters()

    if len(adapters) == 0:
        print("No adapters found")
        exit()

    choice = 0
    if len(adapters) > 1:
        # Query the user to pick an adapter
        print("Please select an adapter:")
        for i, adapter in enumerate(adapters):
            print(f"{i}: {adapter.identifier()} [{adapter.address()}]")

        choice = int(input("Enter choice: "))
    adapter = adapters[choice]

    print(f"Selected adapter: {adapter.identifier()} [{adapter.address()}]")

    adapter.set_callback_on_scan_start(lambda: print("Scan started."))
    adapter.set_callback_on_scan_stop(lambda: print("Scan complete."))

    # Scan for 5 seconds
    adapter.scan_for(5000)
    peripherals = [x for x in adapter.scan_get_results() if x.identifier().startswith("DJI")]

    choice = 0
    if len(peripherals) > 1:
        # Query the user to pick a peripheral
        print("Please select a peripheral:")
        for i, peripheral in enumerate(peripherals):
            print(f"{i}: {peripheral.identifier()} [{peripheral.address()}]")

        choice = int(input("Enter choice: "))
    peripheral = peripherals[choice]

    print(f"Connecting to: {peripheral.identifier()} [{peripheral.address()}]")
    peripheral.connect()

    service_uuid = "0000fff0-0000-1000-8000-00805f9b34fb"
    characteristic_uuid = "0000fff5-0000-1000-8000-00805f9b34fb"

    pan_str = input("Pan value: ")
    tilt_str = input("Tilt value: ")
    while pan_str != "" or tilt_str != "":
        content = create_packet(int(pan_str or "0"), int(tilt_str or "0"), 0)
        print("Sending " + content.hex() + "\n")
        peripheral.write_request(service_uuid, characteristic_uuid, content)
        pan_str = input("Pan value: ")
        tilt_str = input("Tilt value: ")

    peripheral.disconnect()
