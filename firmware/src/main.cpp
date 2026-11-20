#include <Arduino.h>
#include <Arduino_RouterBridge.h>

// High level: HIGH = ติด, LOW = ดับ
// สายแดง = ไปหน้า, สายดำ = ถอย
// เลี้ยวซ้าย/ขวา = สปิน คนละทาง
// ห้ามเปิดแดงกับดำของมอเตอร์ตัวเดียวกันพร้อมกัน
int rightRed = 12;    // D12 IN1 มอเตอร์ขวา
int rightBlack = 11;  // D11 IN2 มอเตอร์ขวา
int leftRed = 10;     // D10 IN3 มอเตอร์ซ้าย
int leftBlack = 9;    // D9  IN4 มอเตอร์ซ้าย
int pumpPin = 8;      // D8 ปั๊มน้ำ เปิด/ปิด

int estop = 0;

void motorsOff() {
  digitalWrite(rightRed, LOW);
  digitalWrite(rightBlack, LOW);
  digitalWrite(leftRed, LOW);
  digitalWrite(leftBlack, LOW);
}

void pumpOff() {
  digitalWrite(pumpPin, LOW);
}

void goForward() {
  motorsOff();
  if (estop == 0) {
    digitalWrite(rightRed, HIGH);
    digitalWrite(leftRed, HIGH);
  }
}

void goBack() {
  motorsOff();
  if (estop == 0) {
    digitalWrite(rightBlack, HIGH);
    digitalWrite(leftBlack, HIGH);
  }
}

void spinLeft() {
  motorsOff();
  if (estop == 0) {
    digitalWrite(rightRed, HIGH);
    digitalWrite(leftBlack, HIGH);
  }
}

void spinRight() {
  motorsOff();
  if (estop == 0) {
    digitalWrite(rightBlack, HIGH);
    digitalWrite(leftRed, HIGH);
  }
}

void pumpStart() {
  if (estop == 1) {
    pumpOff();
  } else {
    digitalWrite(pumpPin, HIGH);
  }
}

void stopAll() {
  estop = 1;
  motorsOff();
  pumpOff();
}

void readyAgain() {
  estop = 0;
  motorsOff();
  pumpOff();
}

void runCommand(String command) {
  if (command == "CMD:MOVE:FORWARD") {
    goForward();
  }
  if (command == "CMD:MOVE:BACK") {
    goBack();
  }
  if (command == "CMD:MOVE:LEFT") {
    spinLeft();
  }
  if (command == "CMD:MOVE:RIGHT") {
    spinRight();
  }
  if (command == "CMD:MOVE:STOP") {
    motorsOff();
  }
  if (command == "CMD:OIL:START") {
    pumpStart();
  }
  if (command == "CMD:PUMP:ON") {
    pumpStart();
  }
  if (command == "CMD:OIL:STOP") {
    pumpOff();
  }
  if (command == "CMD:PUMP:OFF") {
    pumpOff();
  }
  if (command == "CMD:DISCONNECT") {
    motorsOff();
    pumpOff();
  }
  if (command == "CMD:ESTOP:ACTIVE") {
    stopAll();
  }
  if (command == "CMD:ESTOP:RESET") {
    readyAgain();
  }
  if (command == "CMD:INIT") {
    readyAgain();
  }

  Monitor.print("ACK ");
  Monitor.println(command);
}

void setup() {
  pinMode(rightRed, OUTPUT);
  pinMode(rightBlack, OUTPUT);
  pinMode(leftRed, OUTPUT);
  pinMode(leftBlack, OUTPUT);
  pinMode(pumpPin, OUTPUT);
  motorsOff();
  pumpOff();
  Bridge.begin();
}

void loop() {
  if (Monitor.begin() == false) {
    delay(100);
  } else {
    if (Monitor.available() > 0) {
      String command = Monitor.readStringUntil('\n');
      command.trim();
      if (command.length() > 0) {
        runCommand(command);
      }
    }
  }
}
