//! Data adaptation only. Dashboard layouts live in screens/terminal.tsx.
use super::*;
use matecrew_core::contract::{DeviceScreen, DeviceState};
pub fn state_screen<D: DrawTarget<Color = BinaryColor>>(
    d: &mut D,
    state: &DeviceState,
    offline: bool,
) -> Result<(), D::Error> {
    set_theme(Theme::from_name(&state.theme));
    set_locale(&state.office.locale);
    dashboard_screen(d, &state.screen, offline)
}

pub fn dashboard_screen<D: DrawTarget<Color = BinaryColor>>(
    d: &mut D,
    data: &DeviceScreen,
    offline: bool,
) -> Result<(), D::Error> {
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
    value["moreCount"] = json!(data.items.len().saturating_sub(6));
    for (item, data) in value["items"].as_array_mut().unwrap().iter_mut().zip(&data.items) {
        item["visible"] = json!(true);
        // Shown as drawn or at half (`picture`).
        let (full, half) = crate::picture::pictures(&decode_base64(&data.picture).unwrap_or_default());
        item["picture"] = json!(full);
        item["picture48"] = json!(half);
    }
    if let Some(prep) = &data.preparation {
        value["prepRows"] = json!(prep
            .items
            .iter()
            .take(4)
            .map(|i| json!({
                "title":format!("{} {}",i.count,i.name),
                "count":i.count,
                "name":i.name,
                "names":i.names,
                "picture48":crate::picture::pictures(&decode_base64(&i.picture).unwrap_or_default()).1,
                "visible":true
            }))
            .collect::<Vec<_>>());
        // The right key serves the session on this screen (core::flow).
        if !prep.serve_label.is_empty() {
            value["right"] = json!(prep.serve_label);
        }
    }
    let name = if data.preparation.is_some() {
        "preparation"
    } else if data.items.is_empty() {
        "empty"
    } else if data.items.len() == 4 {
        "catalogueFour"
    } else if data.items.len() > 4 {
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
    use matecrew_core::contract::ScreenItem;
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
                picture: "invalid".into(),
            })
            .collect();
        let after = draw(&data, false);
        // Status bar above row 56, key tabs from row 424 (sdk/kit/tokens.ts); 100 bytes a row.
        assert!(&before.bits[..56 * 100] == &after.bits[..56 * 100]);
        assert!(&before.bits[424 * 100..] == &after.bits[424 * 100..]);
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
}
