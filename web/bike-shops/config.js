// Editable launch settings for the Rundoo for Bike Shops page.
// Each value can also be set at build time with the VITE_* variable shown.
const env = import.meta.env;

export const config = {
  // Where "Book a demo" goes (Calendly, HubSpot, etc.). Empty = the on-page request form.
  bookingUrl: env.VITE_BOOKING_URL || '',

  // Walkthrough video, shown in the hero. Screen Studio export. An .mp4/.webm/.mov file URL plays in a native player;
  // a YouTube, Vimeo or Screen Studio share/embed URL is shown in an iframe.
  // Set to '' to show the app screenshot in the hero and a "See how it works" button instead.
  videoUrl: env.VITE_DEMO_VIDEO_URL || '/bike-shops/demo.mp4',
  // WebVTT captions for a file-based video (optional but recommended).
  captionsUrl: env.VITE_DEMO_CAPTIONS_URL || '',
  videoPoster: env.VITE_DEMO_POSTER || '/bike-shops/demo-poster.jpg',
  videoLength: '1 min',

  // Link to the working prototype, shown in the footer.
  appUrl: env.VITE_APP_URL || '/',
};
