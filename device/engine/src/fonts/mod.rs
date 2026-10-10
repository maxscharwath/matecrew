//! OWT's brand faces as bitmap fonts: Montserrat (text, weights 500 and 650) and Space Grotesk
//! (headings, 700), both SIL Open Font License 1.1 (`OFL-*.txt` here). Drawn by
//! `device/tools/fonts/build.ts` at the `grotesk` sizes, in the line boxes of the fonts they
//! replaced; 49 holds figures and `+ - . , : / *` only.
use u8g2_fonts::Font;

macro_rules! faces {
    ($($name:ident),* $(,)?) => {$(
        #[allow(non_camel_case_types)]
        pub struct $name;
        impl Font for $name {
            const DATA: &'static [u8] = include_bytes!(concat!(stringify!($name), ".u8g2font"));
        }
    )*};
}

faces!(
    montserrat_regular_11, montserrat_regular_14, montserrat_regular_17, montserrat_regular_20, montserrat_regular_25,
    montserrat_regular_30, montserrat_regular_35, montserrat_regular_42, montserrat_regular_49,
    montserrat_bold_11, montserrat_bold_14, montserrat_bold_17, montserrat_bold_20, montserrat_bold_25,
    montserrat_bold_30, montserrat_bold_35, montserrat_bold_42, montserrat_bold_49,
    space_grotesk_bold_11, space_grotesk_bold_14, space_grotesk_bold_17, space_grotesk_bold_20, space_grotesk_bold_25,
    space_grotesk_bold_30, space_grotesk_bold_35, space_grotesk_bold_42, space_grotesk_bold_49,
);
