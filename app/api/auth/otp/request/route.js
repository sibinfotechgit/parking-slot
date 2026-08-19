import { NextResponse } from "next/server";
import { createOtp } from "../../../../../lib/otp-store";
import { prisma } from "../../../../../lib/prisma";
import { getWhatsappMode, sendOtpMessage } from "../../../../../lib/whatsapp";

const PARKING_LAUNCH_AT = new Date("2026-08-22T00:00:00+05:30");
const PARKING_LAUNCH_MESSAGE = "The Shreeji Plaza Parking System will start on 22nd August";

export async function POST(request) {
  if (Date.now() < PARKING_LAUNCH_AT.getTime()) {
    return NextResponse.json({ error: PARKING_LAUNCH_MESSAGE, launchLocked: true }, { status: 423 });
  }

  const body = await request.json();
  const mobile = String(body.mobile || "").replace(/\D/g, "");

  if (!/^[0-9]{10}$/.test(mobile)) {
    return NextResponse.json({ error: "Enter a valid 10 digit mobile number." }, { status: 400 });
  }

  const user = await prisma.userMaster.findUnique({ where: { mobile } });
  if (!user || !user.active) {
    return NextResponse.json({ error: "This mobile number is not registered for parking access." }, { status: 403 });
  }

  const otp = createOtp(mobile);
  try {
    const result = await sendOtpMessage(mobile, otp);
    return NextResponse.json({
      mode: getWhatsappMode(),
      sent: result.sent,
      demoOtp: result.mode === "demo" ? otp : undefined,
      message: result.mode === "demo" ? "Demo OTP generated." : "OTP sent on WhatsApp."
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Could not send OTP." }, { status: 500 });
  }
}
