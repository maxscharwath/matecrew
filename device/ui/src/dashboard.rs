//! Data adaptation only. Dashboard layouts live in screens/terminal.tsx.
use super::*;
use matecrew_core::contract::{DeviceScreen, DeviceState, ScreenItem};
pub fn state_screen<D: DrawTarget<Color = BinaryColor>>(
    d: &mut D,
    state: &DeviceState,
    offline: bool,
) -> Result<(), D::Error> {
    set_theme(Theme::from_name(
        state.theme.as_deref().unwrap_or("flipper"),
    ));
    let fallback;
    let data = if let Some(data) = state.screen.as_ref().filter(|s| s.supported()) {
        data
    } else {
        fallback = DeviceScreen {
            version: 1,
            template: "dashboard".into(),
            office_name: state.office.name.clone(),
            time: String::new(),
            wifi_bars: None,
            battery_percent: None,
            battery_low_label: None,
            items: state
                .items
                .iter()
                .map(|i| ScreenItem {
                    name: i.name.clone(),
                    stock: i.stock,
                    low: i.stock <= 0,
                    image: i.image.clone(),
                })
                .collect(),
            chart: None,
            preparation: None,
            low_label: "Stock bas".into(),
            more_label: "autres".into(),
            chart_label: String::new(),
            left_label: state.keys.left.label.clone(),
            right_label: state.keys.right.label.clone(),
        };
        &fallback
    };
    dashboard_screen(d, data, offline)
}

pub fn dashboard_screen<D: DrawTarget<Color = BinaryColor>>(
    d: &mut D,
    data: &DeviceScreen,
    offline: bool,
) -> Result<(), D::Error> {
    if !data.supported() {
        return error_screen(
            d,
            "Écran incompatible",
            "Mets à jour le firmware du terminal.",
        );
    }
    let mut value = serde_json::to_value(data).expect("screen API data");
    value["title"] = json!(if offline {
        "Hors ligne · prises gardées"
    } else {
        &data.office_name
    });
    value["status"] = json!(format!(
        "{} {}",
        data.time,
        data.battery_low_label.clone().unwrap_or_else(|| data
            .battery_percent
            .map(|b| format!("{}%", b.min(100)))
            .unwrap_or_default())
    ));
    value["left"] = json!(data.left_label);
    value["right"] = json!(data.right_label);
    value["more"] = json!(if data.items.len() > 6 {
        format!("+{}", data.items.len() - 6)
    } else {
        String::new()
    });
    for item in value["items"].as_array_mut().unwrap() {
        item["visible"] = json!(true);
        item["bits"] =
            json!(decode_base64(item["image"].as_str().unwrap_or("")).unwrap_or_default());
    }
    if let Some(prep) = &data.preparation {
        value["prepRows"] = json!(prep
            .items
            .iter()
            .take(4)
            .map(|i| json!({"title":format!("{} {}",i.count,i.name),"names":i.names}))
            .collect::<Vec<_>>());
    }
    let name = if data.preparation.is_some() {
        "preparation"
    } else if data.items.is_empty() {
        "empty"
    } else if data.items.len() > 3 {
        "catalogue"
    } else if data.items.len() == 1 {
        "dashboardOne"
    } else if data.items.len() == 2 {
        "dashboardTwo"
    } else {
        "dashboard"
    };
    render(d, name, value)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn data() -> DeviceScreen {
        serde_json::from_str(include_str!("../../fixtures/dashboard.json")).unwrap()
    }
    fn draw(data: &DeviceScreen, offline: bool) -> Frame {
        let mut frame = Frame::new();
        dashboard_screen(&mut frame, data, offline).unwrap();
        frame
    }
    #[test]
    fn api_definition_draws_locally_and_data_updates_change_pixels() {
        let mut data = data();
        let before = draw(&data, false);
        data.items[0].stock -= 1;
        assert!(frame::changed(&before.bits, &draw(&data, false).bits).is_some());
        assert!(frame::changed(&before.bits, &draw(&data, true).bits).is_some());
    }
    #[test]
    fn overflowing_content_cannot_cover_status_or_key_hints() {
        let mut data = data();
        data.chart = None;
        let before = draw(&data, false);
        data.items = (0..100)
            .map(|_| ScreenItem {
                name: "Très long nom 漢字 ".repeat(20),
                stock: i64::MIN,
                low: true,
                image: "invalid".into(),
            })
            .collect();
        let after = draw(&data, false);
        assert!(
            &before.bits[..28 * SCALE as usize * 100] == &after.bits[..28 * SCALE as usize * 100]
        );
        assert!(
            &before.bits[208 * SCALE as usize * 100..] == &after.bits[208 * SCALE as usize * 100..]
        );
    }
    #[test]
    fn renderer_clears_previous_screen_and_handles_empty_and_extreme_history() {
        let mut data = data();
        data.chart.as_mut().unwrap().series = vec![vec![], vec![i64::MIN], vec![i64::MAX; 1000]];
        data.chart.as_mut().unwrap().max = 0;
        let mut reused = draw(&data, false);
        data.items.clear();
        dashboard_screen(&mut reused, &data, false).unwrap();
        assert_eq!(reused.bits, draw(&data, false).bits);
    }
    #[test]
    fn unsupported_definition_has_a_local_error_screen() {
        let mut data = data();
        data.version = 2;
        let actual = draw(&data, false);
        let mut expected = Frame::new();
        error_screen(
            &mut expected,
            "Écran incompatible",
            "Mets à jour le firmware du terminal.",
        )
        .unwrap();
        assert_eq!(actual.bits, expected.bits);
    }
}
