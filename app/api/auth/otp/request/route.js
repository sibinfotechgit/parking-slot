import { NextResponse } from "next/server";
import { createOtp } from "../../../../../lib/otp-store";
import { prisma } from "../../../../../lib/prisma";
import { getWhatsappMode, sendOtpMessage } from "../../../../../lib/whatsapp";

const USER_LOGIN_RESTRICTED = true;
const LOGIN_RESTRICTED_MESSAGE = "Parking login is temporarily restricted. Please wait for further instructions.";

export async function POST(request) {
  const body = await request.json();
  const mobile = String(body.mobile || "").replace(/\D/g, "");

  if (!/^[0-9]{10}$/.test(mobile)) {
    return NextResponse.json({ error: "Enter a valid 10 digit mobile number." }, { status: 400 });
  }

  if (USER_LOGIN_RESTRICTED) {
    return NextResponse.json({ error: LOGIN_RESTRICTED_MESSAGE, loginRestricted: true }, { status: 403 });
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
