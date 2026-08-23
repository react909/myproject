use pyo3::prelude::*;
use rayon::prelude::*;

#[pyfunction]
fn process_heavy_order(quantity: u32, weight_kg: f64) -> PyResult<(String, f64, u64)> {
    if quantity == 0 {
        return Err(pyo3::exceptions::PyValueError::new_err(
            "quantity must be greater than zero",
        ));
    }

    if !(weight_kg.is_finite() && weight_kg > 0.0) {
        return Err(pyo3::exceptions::PyValueError::new_err(
            "weight_kg must be a positive finite number",
        ));
    }

    let iterations = (quantity as u64).saturating_mul(75_000).max(100_000);
    let base = weight_kg / f64::from(quantity.max(1));

    let accumulator = (0..iterations)
        .into_par_iter()
        .map(|idx| {
            let sample = base + (idx as f64 * 0.000_001);
            let normalized = sample.sin().abs() + sample.cos().abs();
            normalized * weight_kg.sqrt()
        })
        .sum::<f64>();

    let score = (accumulator / iterations as f64 * 1000.0).round() / 100.0;
    Ok(("heavy_processed_rust".to_string(), score, iterations))
}

#[pymodule]
fn rust_core(_py: Python<'_>, module: &Bound<'_, PyModule>) -> PyResult<()> {
    module.add_function(wrap_pyfunction!(process_heavy_order, module)?)?;
    Ok(())
}
