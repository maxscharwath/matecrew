//! Expressions in bindings: text built from data, comparisons, logic and arithmetic, evaluated
//! on the device each time a binding is read. No JavaScript: a fixed set of pure operators.
use super::Binding;
use serde_json::{Number, Value};

/// Operator codes, shared with sdk/runtime/expr.ts.
pub mod op {
    pub const CONCAT: u8 = 0;
    pub const EQ: u8 = 1;
    pub const NE: u8 = 2;
    pub const LT: u8 = 3;
    pub const LTE: u8 = 4;
    pub const GT: u8 = 5;
    pub const GTE: u8 = 6;
    pub const AND: u8 = 7;
    pub const OR: u8 = 8;
    pub const NOT: u8 = 9;
    pub const ADD: u8 = 10;
    pub const SUB: u8 = 11;
    pub const MUL: u8 = 12;
    pub const DIV: u8 = 13;
    pub const MOD: u8 = 14;
    pub const MIN: u8 = 15;
    pub const MAX: u8 = 16;
    pub const ROUND: u8 = 17;
    pub const COND: u8 = 18;
    pub const LEN: u8 = 19;
    pub const UPPER: u8 = 20;
    pub const LOWER: u8 = 21;
    pub const FIXED: u8 = 22;
    pub const COALESCE: u8 = 23;
    pub const PAD: u8 = 24;
    /// Translate: a message key and `name, value` pairs; resolved against the scene's messages
    /// when decoded (see `Binding::Message`).
    pub const T: u8 = 25;
}
pub const MAX_ARGS: usize = 16;
/// Nesting of expressions inside expressions.
pub const MAX_DEPTH: usize = 8;

/// Accepted argument counts per operator; `None` for an unknown operator.
pub fn arity(code: u8) -> Option<(usize, usize)> {
    use op::*;
    Some(match code {
        CONCAT => (1, MAX_ARGS),
        EQ | NE | LT | LTE | GT | GTE | SUB | DIV | MOD | FIXED | PAD => (2, 2),
        AND | OR | ADD | MUL | MIN | MAX | COALESCE => (2, MAX_ARGS),
        NOT | ROUND | LEN | UPPER | LOWER => (1, 1),
        COND => (3, 3),
        T => (1, MAX_ARGS),
        _ => return None,
    })
}

/// JavaScript-like truthiness: null, false, 0, "", [] and {} are false.
pub fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|n| n != 0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}

/// How a value reads on screen: numbers without a needless `.0`, nothing for null.
pub fn text(value: &Value) -> String {
    match value {
        Value::String(s) => s.chars().take(512).collect(),
        Value::Number(n) => match (n.as_f64(), n.as_i64()) {
            (_, Some(i)) => i.to_string(),
            (Some(f), _) if f.fract() == 0.0 && f.abs() < 1e15 => format!("{f:.0}"),
            _ => n.to_string(),
        },
        Value::Bool(b) => b.to_string(),
        _ => String::new(),
    }
}

fn number(value: &Value) -> Option<f64> {
    match value {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
    .filter(|n: &f64| n.is_finite())
}

fn num(x: f64) -> Value {
    if !x.is_finite() {
        return Value::Null;
    }
    if x.fract() == 0.0 && x.abs() < 9.0e15 {
        return Value::from(x as i64);
    }
    Number::from_f64(x).map_or(Value::Null, Value::Number)
}

fn equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(_), Value::Number(_)) => number(a) == number(b),
        _ => a == b,
    }
}

fn order(a: &Value, b: &Value) -> Option<std::cmp::Ordering> {
    match (a, b) {
        (Value::String(x), Value::String(y)) => Some(x.cmp(y)),
        _ => number(a)?.partial_cmp(&number(b)?),
    }
}

/// The value of `code` applied to `args`. Total: bad input gives null, never a panic.
pub fn eval(code: u8, args: &[Binding], data: &Value, item: Option<&Value>) -> Value {
    use op::*;
    let arg = |i: usize| args.get(i).map(|b| b.resolve(data, item).into_owned()).unwrap_or(Value::Null);
    let all = || args.iter().take(MAX_ARGS).map(|b| b.resolve(data, item).into_owned());
    let numbers = || all().map(|v| number(&v)).collect::<Option<Vec<f64>>>();
    match code {
        CONCAT => Value::String(all().map(|v| text(&v)).collect::<String>().chars().take(512).collect()),
        EQ => Value::Bool(equal(&arg(0), &arg(1))),
        NE => Value::Bool(!equal(&arg(0), &arg(1))),
        LT | LTE | GT | GTE => {
            let ordering = order(&arg(0), &arg(1));
            Value::Bool(ordering.is_some_and(|o| match code {
                LT => o.is_lt(),
                LTE => o.is_le(),
                GT => o.is_gt(),
                _ => o.is_ge(),
            }))
        }
        AND => Value::Bool(all().all(|v| truthy(&v))),
        OR => Value::Bool(all().any(|v| truthy(&v))),
        NOT => Value::Bool(!truthy(&arg(0))),
        ADD | MUL | MIN | MAX => numbers().map_or(Value::Null, |n| {
            num(match code {
                ADD => n.iter().sum(),
                MUL => n.iter().product(),
                MIN => n.iter().copied().fold(f64::INFINITY, f64::min),
                _ => n.iter().copied().fold(f64::NEG_INFINITY, f64::max),
            })
        }),
        SUB | DIV | MOD => match numbers().as_deref() {
            Some([a, b]) => match code {
                SUB => num(a - b),
                _ if *b == 0.0 => Value::Null,
                DIV => num(a / b),
                _ => num(a.rem_euclid(*b)),
            },
            _ => Value::Null,
        },
        ROUND => number(&arg(0)).map_or(Value::Null, |n| num(n.round())),
        COND => {
            if truthy(&arg(0)) {
                arg(1)
            } else {
                arg(2)
            }
        }
        LEN => Value::from(match arg(0) {
            Value::String(s) => s.chars().count(),
            Value::Array(a) => a.len(),
            Value::Object(o) => o.len(),
            _ => 0,
        }),
        UPPER => Value::String(text(&arg(0)).to_uppercase()),
        LOWER => Value::String(text(&arg(0)).to_lowercase()),
        FIXED => match (number(&arg(0)), number(&arg(1))) {
            (Some(n), Some(d)) => Value::String(format!("{n:.*}", d.clamp(0.0, 6.0) as usize)),
            _ => Value::String(text(&arg(0))),
        },
        PAD => match (number(&arg(0)), number(&arg(1))) {
            (Some(n), Some(w)) if n.fract() == 0.0 && n.abs() < 1e15 => {
                Value::String(format!("{:0w$}", n as i64, w = w.clamp(1.0, 12.0) as usize))
            }
            _ => Value::String(text(&arg(0))),
        },
        COALESCE => all().find(|v| !v.is_null() && v.as_str() != Some("")).unwrap_or(Value::Null),
        // Without a message table, a key reads as itself.
        T => Value::String(text(&arg(0))),
        _ => Value::Null,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn lit(v: Value) -> Binding {
        Binding::Literal { literal: v }
    }
    fn bind(path: &str) -> Binding {
        Binding::Bound { bind: path.into(), fallback: Value::Null }
    }
    fn run(code: u8, args: Vec<Binding>, data: &Value) -> Value {
        eval(code, &args, data, None)
    }
    #[test]
    fn expressions_compute_text_logic_and_numbers_from_data() {
        let data = json!({"view":{"name":"Alex","stock":3,"items":[1,2,3],"price":4.5}});
        assert_eq!(run(op::CONCAT, vec![lit(json!("Bonne pause ")), bind("view.name"), lit(json!(" !"))], &data), json!("Bonne pause Alex !"));
        assert_eq!(run(op::CONCAT, vec![lit(json!("x")), bind("view.stock"), bind("view.price"), bind("missing")], &data), json!("x34.5"));
        assert_eq!(run(op::LT, vec![bind("view.stock"), lit(json!(5))], &data), json!(true));
        assert_eq!(run(op::EQ, vec![bind("view.stock"), lit(json!(3.0))], &data), json!(true));
        assert_eq!(run(op::GT, vec![lit(json!("b")), lit(json!("a"))], &data), json!(true));
        assert_eq!(run(op::GT, vec![lit(json!("b")), lit(json!(1))], &data), json!(false));
        assert_eq!(run(op::ADD, vec![bind("view.stock"), lit(json!(1)), lit(json!(0.5))], &data), json!(4.5));
        assert_eq!(run(op::SUB, vec![bind("view.stock"), lit(json!(1))], &data), json!(2));
        assert_eq!(run(op::DIV, vec![bind("view.stock"), lit(json!(0))], &data), Value::Null);
        assert_eq!(run(op::MOD, vec![lit(json!(-1)), lit(json!(3))], &data), json!(2));
        assert_eq!(run(op::COND, vec![bind("view.items"), lit(json!("plein")), lit(json!("vide"))], &data), json!("plein"));
        assert_eq!(run(op::LEN, vec![bind("view.items")], &data), json!(3));
        assert_eq!(run(op::UPPER, vec![lit(json!("maté"))], &data), json!("MATÉ"));
        assert_eq!(run(op::FIXED, vec![bind("view.price"), lit(json!(2))], &data), json!("4.50"));
        assert_eq!(run(op::PAD, vec![lit(json!(2)), lit(json!(2))], &data), json!("02"));
        assert_eq!(run(op::COALESCE, vec![bind("missing"), lit(json!("")), lit(json!("défaut"))], &data), json!("défaut"));
        assert_eq!(run(op::NOT, vec![lit(json!([]))], &data), json!(true));
        assert_eq!(run(op::AND, vec![lit(json!(1)), lit(json!("x"))], &data), json!(true));
        assert_eq!(run(99, vec![], &data), Value::Null);
        assert_eq!(run(op::SUB, vec![], &data), Value::Null);
    }
}
