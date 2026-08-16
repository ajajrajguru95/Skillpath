/** Verbatim shapes from the live API, captured while exploring the endpoints. */

export const COURSES_URL = "https://syncsphere-hiv6.onrender.com/assignment/course-data"
export const COUNTRY_URL = "https://syncsphere-hiv6.onrender.com/assignment/country-code"

export const youtubeCourse = {
    courseName: "How To YouTube",
    courseCode: "how-to-youtube",
    description:
        "From concept to creation, learn how to build, grow, and monetize a YouTube channel using practical systems and real-world execution.",
    mainCategory: "Content Creation",
    shortCourse: "YouTube",
    courseType: "Original",
    // 199900 paise is Rs 1,999.00 and 3999 cents is $39.99 - the price trap.
    pricePaise: 199900,
    priceUsdCents: 3999,
    mangoId: "a1b2c3d4e5f6789012345678",
    refundable: true,
}

export const podcastCourse = {
    courseName: "Podcast Launchpad",
    courseCode: "podcast-launchpad",
    description: "Plan, record and ship a podcast people finish.",
    mainCategory: "Audio",
    shortCourse: "Podcast",
    courseType: "Original",
    pricePaise: 179900,
    priceUsdCents: 3499,
    mangoId: "b2c3d4e5f6789012345678a1",
    // Not refundable - the badge must be absent for this one.
    refundable: false,
}

export const notionCourse = {
    courseName: "Notion Second Brain",
    courseCode: "notion-second-brain",
    description: "Build a second brain you actually maintain.",
    mainCategory: "Productivity",
    shortCourse: "Notion",
    courseType: "Workshop",
    pricePaise: 79900,
    priceUsdCents: 1499,
    mangoId: "c3d4e5f6789012345678a1b2",
    refundable: true,
}

export const threeCourses = [youtubeCourse, podcastCourse, notionCourse]
