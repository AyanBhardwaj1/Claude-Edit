/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        // the microphone and screen capture only for this site itself: "Record my screen" (components/ScreenRecorder.tsx)
        { key: "Permissions-Policy", value: "camera=(), microphone=(self), display-capture=(self), geolocation=()" },
      ],
    }];
  },
};
export default nextConfig;
